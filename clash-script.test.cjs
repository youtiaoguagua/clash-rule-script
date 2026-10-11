const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "clash-script.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const main = context.main;
const json = (value) => JSON.parse(JSON.stringify(value));
const groups = [
  "PROXY", "US", "JP", "SG", "自动选择", "load-balance", "Google AI", "AI",
  "US 自动选择", "JP 自动选择", "SG 自动选择", "Google AI 自动选择", "AI 自动选择",
];
const aiProviders = [
  "lean-openai", "lean-anthropic", "lean-github-copilot", "lean-microsoft-copilot",
  "lean-cursor", "lean-perplexity", "lean-xai", "lean-windsurf", "lean-poe",
  "lean-mistral", "lean-cohere",
];
const proxy = (name) => ({
  name, type: "ss", server: "127.0.0.1", port: 9999,
  cipher: "aes-128-gcm", password: "test",
});
const fixture = () => ({
  mode: "global",
  proxies: [proxy("US 01"), proxy("Japan 01")],
  "proxy-groups": [{ name: "Old", type: "select", proxies: ["US 01"] }],
  "rule-providers": { unused: { type: "inline", behavior: "domain", payload: ["+.unused.test"] } },
  rules: ["MATCH,Old"],
  "sub-rules": { old: ["MATCH,Old"] },
  dns: { enable: true, nameserver: ["https://doh.pub/dns-query"] },
  tun: { enable: false },
  sniffer: { enable: false },
  "mixed-port": 7890,
  "external-controller": "127.0.0.1:9090",
  secret: "unchanged",
});

test("creates thirteen groups and gives each manual group an automatic choice", () => {
  const output = json(main(fixture()));
  assert.deepEqual(output["proxy-groups"].map((group) => group.name), groups);
  for (const group of output["proxy-groups"].filter((group) =>
    ["PROXY", "US", "JP", "SG", "Google AI", "AI"].includes(group.name))) {
    assert.equal(group.type, "select");
    assert.equal(group["include-all"], true);
    assert.equal(group["empty-fallback"], "REJECT");
    assert.equal(group.interval, undefined);
    assert.equal(group.icon, undefined);
  }
  for (const group of output["proxy-groups"].filter((group) =>
    ["Google AI", "AI"].includes(group.name))) {
    assert.deepEqual(group.proxies, ["US", group.name + " 自动选择", "PROXY"]);
    assert.ok(!group.proxies.includes("DIRECT"));
  }
  assert.equal(output.mode, "rule");
});

test("PROXY merges all nodes with automatic, US, JP, SG and load-balance choices", () => {
  const output = json(main(fixture()));
  const byName = Object.fromEntries(output["proxy-groups"].map((group) => [group.name, group]));
  assert.equal(byName.PROXY.type, "select");
  assert.deepEqual(byName.PROXY.proxies, ["自动选择", "US", "JP", "SG", "load-balance"]);
  assert.equal(byName.PROXY["include-all"], true);
  assert.equal(byName.PROXY["empty-fallback"], "REJECT");
  assert.equal(byName.Proxy, undefined);
  assert.ok(output.rules.includes("RULE-SET,lean-proxy-domain,PROXY"));
  assert.equal(output.rules.at(-1), "MATCH,PROXY");
  function visit(name, stack = []) {
    assert.ok(!stack.includes(name), "Group cycle: " + [...stack, name].join(" -> "));
    for (const candidate of byName[name].proxies || []) {
      if (byName[candidate]) visit(candidate, [...stack, name]);
    }
  }
  for (const name of groups) visit(name);
});

test("automatic subgroups use url-test and load-balance stays round-robin", () => {
  const output = json(main(fixture()));
  const automatic = output["proxy-groups"].find((group) => group.name === "自动选择");
  const automaticGroups = output["proxy-groups"].filter((group) => group.type === "url-test");
  const balanced = output["proxy-groups"].find((group) => group.name === "load-balance");
  assert.equal(automaticGroups.length, 6);
  for (const group of automaticGroups) {
    assert.equal(group.type, "url-test");
    assert.equal(group.tolerance, 50);
  }
  assert.equal(automatic.filter, undefined);
  assert.equal(balanced.type, "load-balance");
  assert.equal(balanced.strategy, "round-robin");
  for (const group of [...automaticGroups, balanced]) {
    assert.equal(group["include-all"], true);
    assert.equal(group["empty-fallback"], "REJECT");
    assert.equal(group.url, "https://www.gstatic.com/generate_204");
    assert.equal(group.interval, 300);
    assert.equal(group.timeout, 5000);
    assert.equal(group.lazy, true);
    assert.equal(group["expected-status"], "204");
  }
  const excluded = new RegExp(balanced["exclude-filter"].replace(/^\(\?i\)/, ""), "i");
  for (const name of ["剩余 100GB", "US Traffic", "Expire tomorrow", "Premium", "频道", "订阅", "JP ISP", "官网", "DIRECT"]) {
    assert.ok(excluded.test(name), name);
  }
  assert.ok(!excluded.test("US01"));
  assert.ok(!excluded.test("Japan01"));
});

test("regional automatic choices stay regional and service automatic choices are independent", () => {
  const output = json(main(fixture()));
  const byName = Object.fromEntries(output["proxy-groups"].map((group) => [group.name, group]));
  for (const region of ["US", "JP", "SG"]) {
    assert.equal(byName[region].type, "select");
    assert.deepEqual(byName[region].proxies, [region + " 自动选择"]);
    assert.equal(byName[region + " 自动选择"].filter, byName[region].filter);
  }
  for (const name of ["Google AI", "AI"]) {
    assert.equal(byName[name].proxies[0], "US");
    assert.ok(byName[name].proxies.includes(name + " 自动选择"));
    assert.equal(byName[name + " 自动选择"].filter, undefined);
  }
  for (const group of output["proxy-groups"].filter((group) => group.type === "url-test")) {
    assert.equal(group.proxies, undefined);
  }
});

test("automatic subgroups are hidden but remain selectable from visible main groups", () => {
  const output = json(main(fixture()));
  const byName = Object.fromEntries(output["proxy-groups"].map((group) => [group.name, group]));
  const visible = output["proxy-groups"].filter((group) => !group.hidden).map((group) => group.name);
  assert.deepEqual(visible, ["PROXY", "US", "JP", "SG", "load-balance", "Google AI", "AI"]);
  for (const group of output["proxy-groups"].filter((group) => group.type === "url-test")) {
    assert.equal(group.hidden, true);
    assert.ok(output["proxy-groups"].some((parent) =>
      parent.type === "select" && (parent.proxies || []).includes(group.name)));
    assert.ok(byName[group.name]);
  }
});

test("preserves nodes, provider subscriptions, DNS, TUN and client settings", () => {
  const input = fixture();
  input["proxy-providers"] = { airport: { type: "http", url: "https://example.com/sub" } };
  input.proxies[0].udp = false;
  const before = json(input);
  const output = json(main(input));
  for (const key of ["proxies", "proxy-providers", "dns", "tun", "sniffer",
    "mixed-port", "external-controller", "secret"]) {
    assert.deepEqual(output[key], before[key], key);
  }
  assert.equal(output["sub-rules"], undefined);
  assert.equal(output["rule-providers"].unused, undefined);
  assert.equal(Object.keys(output["rule-providers"]).length, 22);
});

test("supports provider-only subscriptions and nodes arriving after startup", () => {
  const input = { "proxy-providers": { airport: { type: "file", path: "./nodes.yaml" } } };
  const output = json(main(input));
  const aggregate = output["proxy-groups"].find((group) => group.name === "PROXY");
  assert.equal(aggregate["include-all"], true);
  assert.deepEqual(aggregate.proxies, ["自动选择", "US", "JP", "SG", "load-balance"]);
  assert.equal(output["proxy-groups"][1]["include-all"], true);
  assert.deepEqual(output["proxy-groups"][1].proxies, ["US 自动选择"]);
  assert.ok(output["proxy-groups"][1].filter);
});

test("rejects empty input and group/node name collisions", () => {
  for (const input of [null, [], {}, { proxies: [] }]) {
    assert.throws(() => main(input));
  }
  for (const name of groups) {
    assert.throws(() => main({ proxies: [proxy(name)] }), /conflicting/);
  }
});

test("preserves DNS-referenced rule providers but not unused ones", () => {
  const input = fixture();
  const domestic = { type: "inline", behavior: "domain", payload: ["+.domestic.test"] };
  input["rule-providers"].domestic = domestic;
  input.dns["nameserver-policy"] = { "rule-set:domestic, lean-cn-domain": ["223.5.5.5"] };
  const output = json(main(input));
  assert.deepEqual(output["rule-providers"].domestic, domestic);
  assert.equal(output["rule-providers"].unused, undefined);
  assert.equal(Object.keys(output["rule-providers"]).length, 23);
});

test("reports missing DNS providers before mutating config", () => {
  const input = fixture();
  input.dns["nameserver-policy"] = { "rule-set:missing": ["223.5.5.5"] };
  const before = json(input);
  assert.throws(() => main(input), /missing rule provider/);
  assert.deepEqual(input, before);
});

test("preserves old providers still referenced by rule-mode fake-ip filtering", () => {
  const input = fixture();
  const oldAi = { type: "inline", behavior: "domain", payload: ["+.legacy-ai.example"] };
  input["rule-providers"]["lean-other-ai"] = oldAi;
  input.dns["fake-ip-filter-mode"] = "rule";
  input.dns["fake-ip-filter"] = ["RULE-SET,lean-other-ai,fake-ip", "MATCH,real-ip"];
  const output = json(main(input));
  assert.deepEqual(output["rule-providers"]["lean-other-ai"], oldAi);
  assert.deepEqual(output.dns, input.dns);
  assert.equal(output["rule-providers"].unused, undefined);

  const broken = fixture();
  broken.dns["fake-ip-filter-mode"] = "rule";
  broken.dns["fake-ip-filter"] = ["RULE-SET,missing,fake-ip"];
  const before = json(broken);
  assert.throws(() => main(broken), /missing rule provider/);
  assert.deepEqual(broken, before);
});

test("rejects dangling group references and include-all dialer cycles", () => {
  for (const edit of [
    (input) => { input.proxies[0]["dialer-proxy"] = "Old"; },
    (input) => { input.proxies[0]["dialer-proxy"] = "PROXY"; },
    (input) => { input["proxy-providers"] = { airport: { type: "http", proxy: "Old" } }; },
    (input) => { input.dns.nameserver = ["https://1.1.1.1/dns-query#Old"]; },
    (input) => {
      input["rule-providers"].domestic = { type: "http", proxy: "Old" };
      input.dns["nameserver-policy"] = { "rule-set:domestic": ["223.5.5.5"] };
    },
  ]) {
    const input = fixture();
    edit(input);
    const before = json(input);
    assert.throws(() => main(input), /removed group|include-all group/);
    assert.deepEqual(input, before);
  }
});

test("does not interpret passwords or arbitrary subscription URLs as DNS selectors", () => {
  const input = fixture();
  input.proxies[0].password = "#Old%";
  input["proxy-providers"] = { airport: { type: "http", url: "https://example.com/sub#Old" } };
  const output = json(main(input));
  assert.equal(output.proxies[0].password, "#Old%");
  assert.equal(output["proxy-providers"].airport.url, "https://example.com/sub#Old");
});

test("rule order prioritizes AI and direct-domain exceptions over general proxy rules", () => {
  const output = json(main(fixture()));
  const index = (rule) => {
    const position = output.rules.indexOf(rule);
    assert.ok(position >= 0, "Missing rule: " + rule);
    return position;
  };
  for (const name of aiProviders) {
    assert.ok(index("RULE-SET,lean-google-ai,Google AI") < index("RULE-SET," + name + ",AI"));
    assert.ok(index("RULE-SET,lean-google-ai-login,Google AI") < index("RULE-SET," + name + ",AI"));
    assert.ok(index("RULE-SET," + name + ",AI") < index("RULE-SET,lean-microsoft-cdn,DIRECT"));
  }
  assert.ok(index("RULE-SET,lean-microsoft-cdn,DIRECT") < index("RULE-SET,lean-proxy-domain,PROXY"));
  assert.ok(index("RULE-SET,lean-cn-domain,DIRECT") < index("RULE-SET,lean-proxy-domain,PROXY"));
  assert.ok(index("RULE-SET,lean-proxy-domain,PROXY") < index("RULE-SET,lean-cn-ip,DIRECT"));
  assert.equal(output.rules.at(-1), "MATCH,PROXY");
  assert.ok(output.rules.slice(0, -1).every((rule) => rule.startsWith("RULE-SET,")));
  assert.ok(!output.rules.some((rule) => /stun|DST-PORT|DOMAIN-SUFFIX,google\.com|PROCESS-NAME/i.test(rule)));
  assert.ok(!output.rules.some((rule) => /GEOIP|GEOSITE/.test(rule)));
  for (const rule of output.rules.filter((rule) => rule.startsWith("RULE-SET,"))) {
    assert.ok(output["rule-providers"][rule.split(",")[1]]);
  }
});

test("private IPs are rechecked after resolution and before proxy fallback", () => {
  const output = json(main(fixture()));
  const privateRule = "RULE-SET,lean-private-ip,DIRECT,no-resolve";
  const positions = output.rules.flatMap((rule, index) => rule === privateRule ? [index] : []);
  assert.equal(positions.length, 2);
  assert.ok(positions[0] < output.rules.indexOf("RULE-SET,lean-google-ai,Google AI"));
  assert.ok(positions[1] > output.rules.indexOf("RULE-SET,lean-cn-ip,DIRECT"));
  assert.equal(positions[1], output.rules.length - 2);
  assert.equal(output.rules.at(-1), "MATCH,PROXY");
  assert.deepEqual(output["rule-providers"]["lean-custom-direct"].payload, []);
});

test("HTTP providers use unique cache paths, correct formats and daily updates", () => {
  const providers = Object.values(json(main(fixture()))["rule-providers"])
    .filter((provider) => provider.type === "http");
  assert.equal(providers.length, 15);
  assert.equal(new Set(providers.map((provider) => provider.path)).size, providers.length);
  for (const provider of providers) {
    assert.equal(provider.interval, 86400);
    assert.equal(provider.proxy, "PROXY");
    if (provider.behavior === "classical") {
      assert.equal(provider.format, "text");
      assert.ok(provider.path.endsWith(".txt"));
      assert.ok(provider.url.startsWith("https://ruleset.skk.moe/Clash/non_ip/"));
    } else {
      assert.equal(provider.format, "mrs");
      assert.ok(provider.path.endsWith(".mrs"));
      assert.ok(provider.url.startsWith("https://raw.githubusercontent.com/MetaCubeX/"));
      assert.ok(["domain", "ipcidr"].includes(provider.behavior));
    }
  }
  assert.equal(providers.filter((provider) => provider.format === "mrs").length, 13);
  assert.equal(providers.filter((provider) => provider.format === "text").length, 2);
});

test("replaces broad AI/geolocation buckets with services and Sukka routing", () => {
  const output = json(main(fixture()));
  const providers = output["rule-providers"];
  assert.equal(providers["lean-other-ai"], undefined);
  assert.ok(!Object.values(providers).some((provider) =>
    /category-ai-!cn|geolocation-!cn/.test(provider.url || "")));
  assert.equal(providers["lean-proxy-domain"].url, "https://ruleset.skk.moe/Clash/non_ip/global.txt");
  assert.equal(providers["lean-microsoft-cdn"].url, "https://ruleset.skk.moe/Clash/non_ip/microsoft_cdn.txt");
  for (const name of aiProviders) {
    assert.ok(providers[name], name);
    assert.ok(output.rules.includes("RULE-SET," + name + ",AI"), name);
  }
  assert.ok(!Object.values(providers).some((provider) =>
    /geosite\/(microsoft|bing)\.mrs$/.test(provider.url || "")));
  assert.deepEqual(providers["lean-microsoft-copilot"].payload,
    ["+.copilot.microsoft.com", "+.copilot.cloud.microsoft", "+.copilot.com", "+.copilot-stg.com"]);
});

test("custom exceptions are opt-in and precede service rules, not private networks", () => {
  const defaults = json(main(fixture()));
  for (const kind of ["reject", "direct", "proxy"]) {
    assert.deepEqual(defaults["rule-providers"]["lean-custom-" + kind].payload, []);
  }
  const local = vm.createContext({});
  vm.runInContext(source, local);
  vm.runInContext(`
    CUSTOM_DOMAINS.direct.push("mobile.events.data.microsoft.com");
    CUSTOM_DOMAINS.proxy.push("download.microsoft.com");
    CUSTOM_DOMAINS.reject.push("+.blocked.example");
  `, local);
  const output = json(local.main(fixture()));
  assert.deepEqual(output["rule-providers"]["lean-custom-direct"].payload,
    ["mobile.events.data.microsoft.com"]);
  assert.deepEqual(output["rule-providers"]["lean-custom-proxy"].payload, ["download.microsoft.com"]);
  assert.deepEqual(output["rule-providers"]["lean-custom-reject"].payload, ["+.blocked.example"]);
  for (const [kind, policy] of [["reject", "REJECT"], ["direct", "DIRECT"], ["proxy", "PROXY"]]) {
    const position = output.rules.indexOf("RULE-SET,lean-custom-" + kind + "," + policy);
    assert.ok(position > output.rules.indexOf("RULE-SET,lean-private-ip,DIRECT,no-resolve"));
    assert.ok(position < output.rules.indexOf("RULE-SET,lean-google-ai,Google AI"));
  }
  output["rule-providers"]["lean-custom-direct"].payload.push("temporary.example");
  assert.deepEqual(json(local.main(fixture()))["rule-providers"]["lean-custom-direct"].payload,
    ["mobile.events.data.microsoft.com"]);
});

test("provider declarations contain full literal URLs and readable Unicode characters", () => {
  assert.ok(!source.includes(String.fromCharCode(92) + "u"));
  assert.ok(source.includes("美国|美國"));
  assert.ok(source.includes("官网|官網"));
  assert.ok(!source.includes("ruleBase"));
  const providers = Object.values(json(main(fixture()))["rule-providers"])
    .filter((provider) => provider.type === "http");
  for (const provider of providers) {
    assert.ok(source.includes('url: "' + provider.url + '"'));
    assert.ok(source.includes('path: "' + provider.path + '"'));
  }
});

test("Google login supplements use an exact-domain inline rule set", () => {
  const output = json(main(fixture()));
  assert.deepEqual(output["rule-providers"]["lean-google-ai-login"], {
    type: "inline",
    behavior: "domain",
    format: "yaml",
    payload: ["accounts.google.com", "oauth2.googleapis.com"],
  });
  assert.ok(output.rules.includes("RULE-SET,lean-google-ai-login,Google AI"));
});

test("US filter accepts common labels without matching AUS or Russia", () => {
  const output = json(main(fixture()));
  // The pattern uses only the common RE2/JavaScript regex subset.
  const filter = new RegExp(output["proxy-groups"][1].filter.replace(/^\(\?i\)/, ""), "i");
  for (const name of ["US01", "USA 1", "U.S. 1", "US-West", "United States 01",
    "America 01", "美国 01", "美西 01", "美东 01",
    "🇺🇸 01", "Los Angeles 01", "San Jose 01", "Seattle 01"]) {
    assert.ok(filter.test(name), name);
  }
  for (const name of ["AUS 01", "Russia 01", "RUS 01", "Australia 01", "HK01", "Japan 01"]) {
    assert.ok(!filter.test(name), name);
  }
  const exclude = new RegExp(output["proxy-groups"][1]["exclude-filter"].replace(/^\(\?i\)/, ""), "i");
  for (const name of ["US traffic 100GB", "剩余流量", "官网", "DIRECT", "REJECT"]) {
    assert.ok(exclude.test(name), name);
  }
});

test("JP filter accepts common labels without matching unrelated abbreviations", () => {
  const output = json(main(fixture()));
  const jp = output["proxy-groups"].find((group) => group.name === "JP");
  const filter = new RegExp(jp.filter.replace(/^\(\?i\)/, ""), "i");
  for (const name of ["日本 01", "🇯🇵 01", "JP01", "jp 01", "Japan01", "Tokyo01", "大阪 01", "福岡 01"]) {
    assert.ok(filter.test(name), name);
  }
  for (const name of ["US01", "HK01", "SJP01", "JPY01", "Egypt01"]) {
    assert.ok(!filter.test(name), name);
  }
});

test("SG filter accepts Singapore labels without matching other locations", () => {
  const output = json(main(fixture()));
  const sg = output["proxy-groups"].find((group) => group.name === "SG");
  const filter = new RegExp(sg.filter.replace(/^\(\?i\)/, ""), "i");
  for (const name of ["新加坡 01", "狮城 01", "獅城 01", "🇸🇬 01", "SG01", "sg 01",
    "SGP01", "SIN 01", "Singapore01"]) {
    assert.ok(filter.test(name), name);
  }
  for (const name of ["US01", "HK01", "Japan01", "MSG01", "SSG01", "Singer01"]) {
    assert.ok(!filter.test(name), name);
  }
});

test("running the override again does not duplicate rules or groups", () => {
  const first = main(fixture());
  const before = json(first);
  const second = json(main(first));
  assert.deepEqual(second, before);
});

test("editing generated config does not mutate shared factory defaults", () => {
  const first = main(fixture());
  first["proxy-groups"][0].proxies.push("custom");
  first["proxy-groups"].find((group) => group.name === "JP 自动选择").url = "https://example.com/test";
  first["rule-providers"]["lean-google-ai-login"].payload.push("custom.example");
  first["rule-providers"]["lean-custom-direct"].payload.push("custom.example");
  first.rules.reverse();

  const second = json(main(fixture()));
  assert.deepEqual(second["proxy-groups"][0].proxies, ["自动选择", "US", "JP", "SG", "load-balance"]);
  assert.equal(second["proxy-groups"].find((group) => group.name === "JP 自动选择").url,
    "https://www.gstatic.com/generate_204");
  assert.deepEqual(second["rule-providers"]["lean-google-ai-login"].payload,
    ["accounts.google.com", "oauth2.googleapis.com"]);
  assert.deepEqual(second["rule-providers"]["lean-custom-direct"].payload, []);
  assert.equal(second.rules[0], "RULE-SET,lean-private-domain,DIRECT");
  assert.equal(second.rules.at(-1), "MATCH,PROXY");
});
