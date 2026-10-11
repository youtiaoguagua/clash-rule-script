// 可选实测：MIHOMO_EXECUTABLE 指向内核，MIHOMO_RULE_CACHE 指向含已下载规则集的目录。
// DNS、直连目标和代理节点都在本机模拟，不向被测试的服务发送真实请求。
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { test } = require("node:test");

const executable = process.env.MIHOMO_EXECUTABLE;
const ruleCache = process.env.MIHOMO_RULE_CACHE;
const source = fs.readFileSync(path.join(__dirname, "clash-script.js"), "utf8");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function freePort() {
  // Mihomo mixed-port 同时绑定 TCP 和 UDP，不能只检查 TCP 是否空闲。
  for (let attempt = 0; attempt < 20; attempt++) {
    const tcp = net.createServer();
    const port = await listen(tcp);
    const udp = dgram.createSocket("udp4");
    const available = await new Promise((resolve) => {
      udp.once("error", () => resolve(false));
      udp.bind(port, "127.0.0.1", () => resolve(true));
    });
    await new Promise((resolve) => tcp.close(resolve));
    try { await new Promise((resolve) => udp.close(resolve)); } catch (_) {}
    if (available) return port;
  }
  throw new Error("Could not reserve a free TCP/UDP port");
}

function requestThroughProxy(port, domain, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    socket.setTimeout(5000, () => socket.destroy(new Error("Proxy request timed out")));
    socket.on("connect", () => socket.write(
      `GET http://${domain}:${targetPort}/routing-test HTTP/1.1\r\n` +
      `Host: ${domain}:${targetPort}\r\nConnection: close\r\n\r\n`));
    socket.on("data", (chunk) => { response += chunk.toString(); });
    socket.on("end", () => resolve({
      status: Number(response.split(" ")[1]),
      body: response.split("\r\n\r\n")[1],
    }));
    socket.on("error", reject);
  });
}

function requestUdpThroughProxy(port, domain, targetPort) {
  // 用 SOCKS5 UDP ASSOCIATE 验证解析后私有 IP 的 UDP 选路。
  return new Promise((resolve, reject) => {
    const control = net.connect(port, "127.0.0.1");
    const udp = dgram.createSocket("udp4");
    let phase = 0;
    let buffered = Buffer.alloc(0);
    let done = false;
    const timer = setTimeout(() => finish(new Error("UDP proxy request timed out")), 5000);
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      control.destroy();
      try { udp.close(); } catch (_) {}
      if (error) reject(error);
      else resolve(result);
    }
    control.on("error", finish);
    control.on("end", () => finish(new Error("UDP association closed")));
    udp.on("error", finish);
    udp.on("message", (message) => {
      try {
        assert.equal(message.readUInt16BE(0), 0);
        assert.equal(message[2], 0);
        const addressEnd = message[3] === 1 ? 8
          : message[3] === 4 ? 20
          : message[3] === 3 ? 5 + message[4] : 0;
        assert.ok(addressEnd);
        finish(null, message.subarray(addressEnd + 2).toString());
      } catch (error) { finish(error); }
    });
    control.on("connect", () => control.write(Buffer.from([5, 1, 0])));
    control.on("data", (chunk) => {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        if (phase === 0 && buffered.length >= 2) {
          assert.deepEqual([...buffered.subarray(0, 2)], [5, 0]);
          buffered = buffered.subarray(2);
          phase = 1;
          control.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
        }
        if (phase === 1 && buffered.length >= 10) {
          assert.deepEqual([...buffered.subarray(0, 4)], [5, 0, 0, 1]);
          const relayPort = buffered.readUInt16BE(8);
          phase = 2;
          const hostname = Buffer.from(domain);
          const destinationPort = Buffer.alloc(2);
          destinationPort.writeUInt16BE(targetPort);
          const packet = Buffer.concat([
            Buffer.from([0, 0, 0, 3, hostname.length]),
            hostname,
            destinationPort,
            Buffer.from("LAN-UDP"),
          ]);
          udp.send(packet, relayPort, "127.0.0.1", (error) => {
            if (error) finish(error);
          });
        }
      } catch (error) { finish(error); }
    });
  });
}

function createMockProxy(name, requests) {
  function responseFor(requestLine) {
    const health = requestLine.includes("/health");
    if (!health) requests.push(name);
    return { health, body: health ? "" : name };
  }

  const server = http.createServer((request, response) => {
    const { health, body } = responseFor(request.url);
    response.writeHead(health ? 204 : 200, {
      "content-length": Buffer.byteLength(body),
      connection: "close",
    });
    response.end(body);
  });
  server.on("connect", (request, socket, head) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    let buffered = head.toString();
    function receive(chunk) {
      buffered += chunk.toString();
      if (!buffered.includes("\r\n\r\n")) return;
      socket.removeListener("data", receive);
      const { health, body } = responseFor(buffered.split("\r\n")[0]);
      socket.end(
        `HTTP/1.1 ${health ? "204 No Content" : "200 OK"}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    }
    socket.on("data", receive);
    socket.on("error", () => {});
    if (buffered.includes("\r\n\r\n")) receive(Buffer.alloc(0));
  });
  return server;
}

function createMockDns() {
  // 直连用本地服务模拟；其他域名用公网 IP 模拟，避免把所有请求都解析成私网。
  const localDomains = new Set([
    "chatgpt.com",
    "download.microsoft.com",
    "officecdn.microsoft.com",
    "vscode.download.prss.microsoft.com",
    "www.qq.com",
    "router.lan-regression.example.net",
    "nas.lan-regression.example.net",
  ]);
  const socket = dgram.createSocket("udp4");
  socket.on("message", (query, client) => {
    // 保留查询问题，按测试域名返回 IPv4；AAAA 返回空结果。
    let end = 12;
    const labels = [];
    while (query[end]) {
      const length = query[end];
      labels.push(query.subarray(end + 1, end + 1 + length).toString());
      end += length + 1;
    }
    end++;
    const address = localDomains.has(labels.join(".").toLowerCase()) ? [127, 0, 0, 1] : [8, 8, 8, 8];
    const type = query.readUInt16BE(end);
    const question = query.subarray(12, end + 4);
    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 4);
    const answer = type === 1 ? Buffer.from(
      [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, ...address]) : Buffer.alloc(0);
    header.writeUInt16BE(type === 1 ? 1 : 0, 6);
    socket.send(Buffer.concat([header, question, answer]), client.port, client.address);
  });
  return socket;
}

const routingCases = [
  ["gemini.google.com", "US"],
  ["notebooklm.google.com", "US"],
  ["generativelanguage.googleapis.com", "US"],
  ["accounts.google.com", "US"],
  ["chatgpt.com", "US"],
  ["claude.ai", "US"],
  ["api.githubcopilot.com", "US"],
  ["copilot.microsoft.com", "US"],
  ["cursor.com", "US"],
  ["perplexity.ai", "US"],
  ["grok.com", "US"],
  ["windsurf.com", "US"],
  ["poe.com", "US"],
  ["mistral.ai", "US"],
  ["cohere.com", "US"],
  ["download.microsoft.com", "DIRECT"],
  ["officecdn.microsoft.com", "DIRECT"],
  ["vscode.download.prss.microsoft.com", "DIRECT"],
  ["update.code.visualstudio.com", "SG"],
  ["www.qq.com", "DIRECT"],
  ["api.github.com", "SG"],
  ["huggingface.co", "SG"],
  ["ollama.com", "SG"],
  ["themeforest.net", "SG"],
  ["mobile.events.data.microsoft.com", "SG"],
  ["router.lan-regression.example.net", "DIRECT"],
  ["nas.lan-regression.example.net", "DIRECT"],
];

test("mixed-source rules route real requests through a local mihomo core", {
  skip: !executable || !ruleCache,
  timeout: 60000,
}, async (t) => {
  assert.ok(fs.existsSync(executable), "MIHOMO_EXECUTABLE does not exist");
  const requests = [];
  const servers = [];
  const dns = createMockDns();
  const udpOrigin = dgram.createSocket("udp4");
  await new Promise((resolve) => dns.bind(0, "127.0.0.1", resolve));
  const dnsAddress = `udp://127.0.0.1:${dns.address().port}`;
  try {
    udpOrigin.on("message", (message, client) => {
      udpOrigin.send(message, client.port, client.address);
    });
    await new Promise((resolve) => udpOrigin.bind(0, "127.0.0.1", resolve));
    const udpOriginPort = udpOrigin.address().port;
    const origin = http.createServer((request, response) => {
      requests.push("DIRECT");
      response.writeHead(200, { "content-length": 6, connection: "close" });
      response.end("DIRECT");
    });
    servers.push(origin);
    const originPort = await listen(origin);
    const nodes = [];
    for (const name of ["US", "SG"]) {
      const server = createMockProxy(name, requests);
      servers.push(server);
      nodes.push({
        name: name + " Integration",
        type: "http",
        server: "127.0.0.1",
        port: await listen(server),
      });
    }

    async function runCase(name, providerOnly, custom) {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "clash-routing-" + name + "-"));
      const context = vm.createContext({});
      vm.runInContext(source, context);
      if (custom) vm.runInContext(`
        CUSTOM_DOMAINS.direct.push("chatgpt.com");
        CUSTOM_DOMAINS.proxy.push("download.microsoft.com");
        CUSTOM_DOMAINS.reject.push("custom-block.com");
      `, context);
      const controllerPort = await freePort();
      let mixedPort = await freePort();
      while (mixedPort === controllerPort) mixedPort = await freePort();
      const nodeConfig = providerOnly
        ? { "proxy-providers": { airport: { type: "file", path: "./airport.json" } } }
        : { proxies: nodes };
      fs.writeFileSync(path.join(workspace, "airport.json"), JSON.stringify({ proxies: nodes }));
      const config = context.main({
        ...nodeConfig,
        "mixed-port": mixedPort,
        "external-controller": `127.0.0.1:${controllerPort}`,
        profile: { "store-selected": false },
        "log-level": "info",
        dns: {
          enable: true,
          listen: "",
          ipv6: false,
          "use-hosts": false,
          "use-system-hosts": false,
          "enhanced-mode": "redir-host",
          nameserver: [dnsAddress],
          "default-nameserver": [dnsAddress],
          "fallback-filter": { geoip: false },
        },
      });
      for (const group of config["proxy-groups"]) {
        if (group.url) group.url = `http://health.integration.test:${originPort}/health`;
      }
      for (const provider of Object.values(config["rule-providers"])) {
        if (provider.type !== "http") continue;
        const cached = path.resolve(ruleCache, provider.path);
        assert.ok(fs.existsSync(cached), "Missing cached rule file: " + cached);
        const destination = path.resolve(workspace, provider.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(cached, destination);
      }
      const filename = path.join(workspace, "config.json");
      fs.writeFileSync(filename, JSON.stringify(config, null, 2));
      const child = spawn(executable, ["-d", workspace, "-f", filename], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let logs = "";
      child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
      child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
      const exited = new Promise((resolve) => child.on("exit", resolve));
      const base = `http://127.0.0.1:${controllerPort}`;
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (child.exitCode !== null) break;
          try {
            const response = await fetch(base + "/providers/rules", {
              signal: AbortSignal.timeout(1000),
            });
            const providers = (await response.json()).providers;
            const remoteNames = Object.keys(config["rule-providers"])
              .filter((key) => config["rule-providers"][key].type === "http");
            if (Object.keys(providers).length === 22 &&
                remoteNames.every((key) => providers[key].ruleCount > 0)) {
              ready = true;
              break;
            }
          } catch (_) { /* 等待内核和规则集初始化。 */ }
          await pause(100);
        }
        assert.ok(ready, "Core failed to load rules:\n" + logs);
        const liveGroups = (await (await fetch(base + "/proxies")).json()).proxies;
        for (const group of config["proxy-groups"]) {
          if (group.type === "url-test") {
            assert.equal(liveGroups[group.name].hidden, true);
          } else {
            assert.notEqual(liveGroups[group.name].hidden, true);
          }
        }
        const selection = await fetch(base + "/proxies/PROXY", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "SG Integration" }),
        });
        assert.equal(selection.status, 204);

        if (!custom) {
          const response = await requestUdpThroughProxy(
            mixedPort, "router.lan-regression.example.net", udpOriginPort);
          assert.equal(response, "LAN-UDP", logs);
        }
        const cases = custom ? [
          ["chatgpt.com", "DIRECT"],
          ["download.microsoft.com", "SG"],
          ["copilot.microsoft.com", "US"],
        ] : routingCases;
        for (const [domain, policy] of cases) {
          const response = await requestThroughProxy(mixedPort, domain, originPort);
          assert.equal(response.status, 200, domain + "\n" + logs);
          assert.equal(response.body, policy, domain + "\n" + logs);
        }
        if (!custom) {
          await pause(25);
          assert.ok(logs.includes(
            `router.lan-regression.example.net:${udpOriginPort} match RuleSet(lean-private-ip) using DIRECT`),
          "Private-address UDP fallback did not match\n" + logs);
          for (const domain of ["router.lan-regression.example.net", "nas.lan-regression.example.net"]) {
            assert.ok(logs.includes(
              `${domain}:${originPort} match RuleSet(lean-private-ip) using DIRECT`),
            "Private-address fallback did not handle " + domain + "\n" + logs);
          }
        }
        if (custom) {
          const count = requests.length;
          const blocked = await requestThroughProxy(mixedPort, "custom-block.com", originPort)
            .catch(() => ({ status: 0 }));
          assert.notEqual(blocked.status, 200);
          assert.equal(requests.length, count, "Rejected request reached an upstream");
        }
        t.diagnostic(`${name}: ${cases.length + 1} routing cases passed; fixtures ${workspace}`);
      } finally {
        child.kill();
        await exited;
        fs.writeFileSync(path.join(workspace, "mihomo.log"), logs);
      }
    }

    await t.test("normal subscription", () => runCase("normal", false, false));
    await t.test("provider-only subscription", () => runCase("provider", true, false));
    await t.test("custom direct, proxy and reject exceptions", () => runCase("custom", false, true));
  } finally {
    dns.close();
    udpOrigin.close();
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
  }
});
