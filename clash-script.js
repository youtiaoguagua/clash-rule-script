// Clash Party / Mihomo Party / Clash Verge Rev 覆写脚本，需要较新的 Mihomo 内核。
// 用完整文件替换旧脚本，不要把两个分流脚本叠加运行。
// 默认生成可在界面切换的链式分组；普通代理仍使用原始节点。
// 不修改 DNS、TUN、端口、订阅地址或凭据。
// US 按节点名称筛选，不检测实际出口国家，也不保证 AI 服务可用。
// 主要使用 RULE-SET，GEOIP 补充国内 IP 兜底，最终使用 MATCH；远程规则集每天更新。
//
// 文件结构：
//   1. 常用设置      通常只需要改这一节
//   2. 节点分组      代理组的结构与默认选项
//   3. 规则          规则集和匹配顺序合在一张表里
//   4. 分组构建函数  统一默认参数
//   5. 链式代理      生成前置 / 落地节点池
//   6. DNS 规则集    保留现有 DNS 仍在引用的规则集
//   7. 入口          main()

// ─────────────────────────────────────────────
// 1. 常用设置
// ─────────────────────────────────────────────

const RULE_UPDATE_INTERVAL = 86400; // 规则集更新间隔，单位为秒。
const URL_TEST_TOLERANCE = 50; // 延迟差在 50 ms 内时，不频繁切换节点。

const HEALTH_CHECK = {
  url: "https://www.gstatic.com/generate_204",
  interval: 300, // 检查间隔，单位为秒。
  timeout: 5000, // 超时时间，单位为毫秒。
  lazy: true,
  "expected-status": "204",
};

// 订阅提示节点（流量、到期、官网等）和内核内置节点的公共匹配词。
const NOTICE_WORDS =
  "官网|官網|套餐|剩余|剩餘|流量|到期|过期|過期|有效期|重置|" +
  "traffic|expire|\\b(official|website|renewal|reset)\\b";
const BUILTIN_NODES = "^(DIRECT|REJECT(-DROP)?|COMPATIBLE|PASS|DNS)$";

const NODE_FILTERS = {
  us:
    "(?i)(美国|美國|美西|美东|美東|美中|美南|美北|" +
    "洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|" +
    "纽约|紐約|达拉斯|達拉斯|芝加哥|硅谷|矽谷|🇺🇸|" +
    "united[ _-]?states|america|los[ _-]?angeles|san[ _-]?jose|seattle|" +
    "new[ _-]?york|dallas|chicago|silicon[ _-]?valley|(^|[^a-z])u[ ._-]?s(a)?([^a-z]|$))",
  jp:
    "(?i)(日本|东京|東京|大阪|埼玉|名古屋|福冈|福岡|🇯🇵|" +
    "japan|tokyo|osaka|(^|[^a-z])jp([^a-z]|$))",
  sg:
    "(?i)(新加坡|狮城|獅城|🇸🇬|singapore|(^|[^a-z])(sg(p)?|sin)([^a-z]|$))",
  exclude: "(?i)(" + NOTICE_WORDS + "|" + BUILTIN_NODES + ")",
  // 负载均衡额外排除 Premium 和 ISP 标签。
  // GB 只匹配“数字 + GB”，ISP 只匹配独立单词，避免误伤名称中恰好含这些字母的节点。
  loadBalanceExclude:
    "(?i)(\\d\\s?GB|Premium|频道|订阅|(^|[^a-z])isp([^a-z]|$)|" +
    NOTICE_WORDS + "|" + BUILTIN_NODES + ")",
};

// 自定义域名例外，默认不额外直连或拦截任何服务。
// "example.com" 仅匹配该域名，"+.example.com" 同时匹配它及其子域名。
// 留空的列表不会生成规则集和规则。
const CUSTOM_DOMAINS = {
  direct: [],
  proxy: [],
  reject: [],
};

// 自动模式直接使用当前订阅，不需要填写节点名。前置使用原节点，落地使用独立副本。
// 专用入口 / 住宅落地可改为 mode: "manual"，再填写下面的来源。
// mode 只决定节点池来源；两种模式都保留界面中的前置 / 落地选择。
const CHAIN_PROXY = {
  enabled: true,
  mode: "auto",
  front: { providers: [], nodes: [] },
  exit: { providers: [], nodes: [] },
  // 下载节点和规则时，不依赖尚未建立的链路。也可填写一个未串联的静态节点名称。
  downloadProxy: "DIRECT",
};

const CHAIN_GROUPS = {
  front: "前置代理",
  frontAuto: "前置自动选择",
  exit: "链式代理",
  exitAuto: "链式自动选择",
};

const CHAIN_COPY = {
  nodePrefix: "链式落地 | ",
  providerPrefix: "lean-chain-exit:",
};

function chainEnabled() {
  return CHAIN_PROXY.enabled === true;
}

function chainAutomatic() {
  return CHAIN_PROXY.mode === "auto";
}

// 规则集下载走哪个代理：链式模式下不能依赖尚未建立的链路。
function downloadProxyName() {
  return chainEnabled() ? CHAIN_PROXY.downloadProxy : "PROXY";
}

// ─────────────────────────────────────────────
// 2. 节点分组：proxies 中的第一个选项就是默认选择
// ─────────────────────────────────────────────

function createProxyGroups(chain) {
  const pool = chain ? chain.normalPool : undefined;
  const chainChoice = chain ? [CHAIN_GROUPS.exit] : [];
  const groups = [
    // 总入口含全部节点；不加入 AI 分组，避免相互引用。
    selectGroup({
      name: "PROXY",
      proxies: ["自动选择", "US", "JP", "SG", "load-balance", ...chainChoice],
      pool,
    }),
    // 地区组同时提供该地区的自动选择和单个节点。
    selectGroup({ name: "US", proxies: ["US 自动选择"], filter: NODE_FILTERS.us, pool }),
    selectGroup({ name: "JP", proxies: ["JP 自动选择"], filter: NODE_FILTERS.jp, pool }),
    selectGroup({ name: "SG", proxies: ["SG 自动选择"], filter: NODE_FILTERS.sg, pool }),
    urlTestGroup({ name: "自动选择", pool }),
    loadBalanceGroup({ name: "load-balance", pool }),
    // AI 默认仍走 US，也可选择全节点自动测速。
    // 全节点自动测速直接复用“自动选择”（它只含节点），避免重复健康检查。
    selectGroup({ name: "Google AI", proxies: ["US", "自动选择", ...chainChoice, "PROXY"], pool }),
    selectGroup({ name: "AI", proxies: ["US", "自动选择", ...chainChoice, "PROXY"], pool }),

    // 自动测速子组只包含节点，不引用上层分组；隐藏独立卡片，保留主组内的选项。
    urlTestGroup({ name: "US 自动选择", filter: NODE_FILTERS.us, pool }),
    urlTestGroup({ name: "JP 自动选择", filter: NODE_FILTERS.jp, pool }),
    urlTestGroup({ name: "SG 自动选择", filter: NODE_FILTERS.sg, pool }),
  ];
  if (chain) {
    groups.push(
      selectGroup({ name: CHAIN_GROUPS.front, proxies: [CHAIN_GROUPS.frontAuto], pool: chain.frontPool }),
      urlTestGroup({ name: CHAIN_GROUPS.frontAuto, pool: chain.frontPool }),
      selectGroup({ name: CHAIN_GROUPS.exit, proxies: [CHAIN_GROUPS.exitAuto], pool: chain.exitPool }),
      urlTestGroup({ name: CHAIN_GROUPS.exitAuto, pool: chain.exitPool }),
    );
  }
  return groups;
}

// ─────────────────────────────────────────────
// 3. 规则：每一项同时定义规则集和匹配目标，顺序就是匹配顺序
// ─────────────────────────────────────────────
// 先匹配的规则生效。没有 provider 的项表示复用前面已定义的同名规则集。
// rule 字段用于不依赖远程规则集的内核规则。
// MetaCubeX 使用 domain/ipcidr + mrs，Sukka 使用 classical + text。


function createRuleSets() {
  // 只有手动填入 CUSTOM_DOMAINS 的域名才会生成这些例外。
  const custom = [["reject", "REJECT"], ["direct", "DIRECT"], ["proxy", "PROXY"]]
    .filter(([kind]) => CUSTOM_DOMAINS[kind].length > 0)
    .map(([kind, target]) => ({
      name: "lean-custom-" + kind,
      target,
      provider: inlineDomainProvider(CUSTOM_DOMAINS[kind]),
    }));

  return [
    // 局域网及私有域名 / IP 网段。
    {
      name: "lean-private-domain",
      target: "DIRECT",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/private.mrs",
        path: "./ruleset/lean-ai/geosite-private.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-private-ip",
      target: "DIRECT",
      noResolve: true,
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/private.mrs",
        path: "./ruleset/lean-ai/geoip-private.mrs",
        behavior: "ipcidr",
      }),
    },

    // 自定义例外优先于下面的外网服务规则，不会改变私有网络规则。
    ...custom,

    // 服务级 AI 规则优先于普通服务直连规则；不使用 category-ai-!cn 大分类。
    {
      name: "lean-google-ai",
      target: "Google AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/google-gemini.mrs",
        path: "./ruleset/lean-ai/geosite-google-gemini.mrs",
        behavior: "domain",
      }),
    },
    // 只补充两个共享登录域名，不把全部 Google 域名分到 AI 组。
    {
      name: "lean-google-ai-login",
      target: "Google AI",
      provider: inlineDomainProvider(["accounts.google.com", "oauth2.googleapis.com"]),
    },
    {
      name: "lean-openai",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/openai.mrs",
        path: "./ruleset/lean-ai/geosite-openai.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-anthropic",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/anthropic.mrs",
        path: "./ruleset/lean-ai/geosite-anthropic.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-github-copilot",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/github-copilot.mrs",
        path: "./ruleset/lean-ai/geosite-github-copilot.mrs",
        behavior: "domain",
      }),
    },
    // 使用少量明确的域名补充，不把整个微软或 Bing 分到 AI。
    {
      name: "lean-microsoft-copilot",
      target: "AI",
      provider: inlineDomainProvider([
        "+.copilot.microsoft.com",
        "+.copilot.cloud.microsoft",
        "+.copilot.com",
        "+.copilot-stg.com",
      ]),
    },
    {
      name: "lean-cursor",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cursor.mrs",
        path: "./ruleset/lean-ai/geosite-cursor.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-perplexity",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/perplexity.mrs",
        path: "./ruleset/lean-ai/geosite-perplexity.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-xai",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/xai.mrs",
        path: "./ruleset/lean-ai/geosite-xai.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-windsurf",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/windsurf.mrs",
        path: "./ruleset/lean-ai/geosite-windsurf.mrs",
        behavior: "domain",
      }),
    },
    {
      name: "lean-poe",
      target: "AI",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/poe.mrs",
        path: "./ruleset/lean-ai/geosite-poe.mrs",
        behavior: "domain",
      }),
    },
    { name: "lean-mistral", target: "AI", provider: inlineDomainProvider(["+.mistral.ai"]) },
    { name: "lean-cohere", target: "AI", provider: inlineDomainProvider(["+.cohere.ai", "+.cohere.com"]) },

    // 域名直连例外在海外集合前，国内 IP 兜底仍在海外集合后。
    // 微软的大陆 CDN 直连；不包含全微软直连或遥测拦截。
    {
      name: "lean-microsoft-cdn",
      target: "DIRECT",
      provider: ruleProvider({
        url: "https://ruleset.skk.moe/Clash/non_ip/microsoft_cdn.txt",
        path: "./ruleset/lean-ai/sukka-microsoft-cdn.txt",
        behavior: "classical",
        format: "text",
      }),
    },
    // 国内域名优先于通用海外集合。
    {
      name: "lean-cn-domain",
      target: "DIRECT",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/cn.mrs",
        path: "./ruleset/lean-ai/geosite-cn.mrs",
        behavior: "domain",
      }),
    },
    // Sukka 通用海外服务集合，仍需放在明确的直连例外之后。
    {
      name: "lean-proxy-domain",
      target: "PROXY",
      provider: ruleProvider({
        url: "https://ruleset.skk.moe/Clash/non_ip/global.txt",
        path: "./ruleset/lean-ai/sukka-global.txt",
        behavior: "classical",
        format: "text",
      }),
    },
    {
      name: "lean-cn-ip",
      target: "DIRECT",
      provider: ruleProvider({
        url: "https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo/geoip/cn.mrs",
        path: "./ruleset/lean-ai/geoip-cn.mrs",
        behavior: "ipcidr",
      }),
    },
    // CN 规则集未命中时，再用内核 GeoIP 兜底，不把国内裸 IP 直接送到 MATCH。
    { rule: "GEOIP,CN,DIRECT" },
    // IP 规则已触发解析，再检查私有 IP，避免内网域名落入代理兜底。
    { name: "lean-private-ip", target: "DIRECT", noResolve: true },
  ];
}

function createRuleProviders(ruleSets) {
  const providers = {};
  for (const { name, provider } of ruleSets) {
    if (provider) providers[name] = provider;
  }
  return providers;
}

function createRules(ruleSets) {
  const rules = ruleSets.map(({ name, target, noResolve, rule }) =>
    rule || "RULE-SET," + name + "," + target + (noResolve ? ",no-resolve" : ""));
  return [...rules, "MATCH,PROXY"];
}

// 规则目标写错会让内核启动失败，提前给出明确的报错。
function assertRuleTargets(rules, groups) {
  const known = new Set(["DIRECT", "REJECT", ...groups.map(group => group.name)]);
  for (const rule of rules) {
    const parts = rule.split(",");
    const target = parts[0] === "MATCH" ? parts[1] : parts[2];
    if (!known.has(target)) throw new Error("Rule target group not found: " + target);
  }
}

// ─────────────────────────────────────────────
// 4. 分组构建函数：统一默认参数，通常不需要修改
// ─────────────────────────────────────────────

function ruleProvider({ url, path, behavior, format = "mrs" }) {
  return {
    type: "http",
    behavior,
    format,
    url,
    path,
    interval: RULE_UPDATE_INTERVAL,
    proxy: downloadProxyName(),
  };
}

function inlineDomainProvider(payload) {
  return {
    type: "inline",
    behavior: "domain",
    format: "yaml",
    payload: [...payload],
  };
}

// 节点池有两种形态，字段保持一致，方便 applyPool 统一处理：
//   explicitPool  只使用列出的节点和订阅（前置 / 落地）。
//   allNodesPool  使用全部静态节点再排除指定节点（普通代理，排除落地副本）。
// 静态节点交给内核引入再筛选；直接写入 proxies 会绕过 US / JP / SG 的 filter。
function explicitPool(nodes, providers) {
  return { nodes, providers, allStatic: false, excludedNodes: [] };
}

function allNodesPool(providers, excludedNodes) {
  return { nodes: [], providers, allStatic: true, excludedNodes };
}

function applyPool(group, pool) {
  delete group["include-all"];
  group.use = [...pool.providers];
  if (pool.allStatic) {
    group["include-all-proxies"] = true;
  } else if (pool.nodes.length) {
    group.proxies = [...(group.proxies || []), ...pool.nodes];
  }
  const excluded = excludedNodeFilter(pool.excludedNodes);
  if (excluded) group["exclude-filter"] += "|" + excluded;
}

function selectGroup({ name, proxies, filter, pool, excludeFilter = NODE_FILTERS.exclude }) {
  const group = {
    name,
    type: "select",
    "exclude-filter": excludeFilter,
    "exclude-type": "Direct|Reject|RejectDrop|Compatible|Pass|Dns",
    // 没有候选节点时拒绝连接，不意外回退为直连。
    "empty-fallback": "REJECT",
  };
  if (proxies) group.proxies = proxies;
  if (filter) group.filter = filter;
  if (pool) applyPool(group, pool);
  else group["include-all"] = true;
  return group;
}

function urlTestGroup(options) {
  return {
    ...selectGroup(options),
    ...HEALTH_CHECK,
    type: "url-test",
    hidden: true,
    tolerance: URL_TEST_TOLERANCE,
  };
}

function loadBalanceGroup({ name, pool }) {
  return {
    ...selectGroup({ name, pool, excludeFilter: NODE_FILTERS.loadBalanceExclude }),
    ...HEALTH_CHECK,
    type: "load-balance",
    strategy: "round-robin",
  };
}

function excludedNodeFilter(names) {
  if (!names.length) return "";
  const escaped = names.map(function (name) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/`/g, "\\x60");
  });
  // 普通排除规则是 (?i)，这里恢复大小写敏感，避免误伤名称仅大小写不同的节点。
  return "(?-i)^(?:" + escaped.join("|") + ")$";
}

// ─────────────────────────────────────────────
// 5. 链式代理：落地副本只进入链式组，原节点继续用于普通代理和前置
// ─────────────────────────────────────────────

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isProxyNode(node) {
  return !["direct", "reject", "reject-drop", "compatible", "pass", "pass-rule", "rematch", "dns"]
    .includes(String(node.type).toLowerCase());
}

function isChainedProvider(provider) {
  return Boolean(
    provider["dialer-proxy"] ||
    (provider.override || {})["dialer-proxy"] ||
    (provider.payload || []).some(node => node["dialer-proxy"]),
  );
}

// 32 位 FNV-1a，用于生成定长缓存文件名，避免长名称或特殊字符超出文件名限制。
function shortHash(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// 自动模式生成带前缀的副本；手动模式保持原名，直接替换原节点。
function copyExitNode(node, automatic) {
  return {
    ...node,
    name: automatic ? CHAIN_COPY.nodePrefix + node.name : node.name,
    "dialer-proxy": CHAIN_GROUPS.front,
  };
}

function copyExitProvider(provider, automatic, name) {
  const override = { ...provider.override };
  if (automatic) {
    override["additional-prefix"] = CHAIN_COPY.nodePrefix + (override["additional-prefix"] || "");
  }
  override["dialer-proxy"] = CHAIN_GROUPS.front;
  const copy = { ...provider, override };
  // HTTP 副本独立缓存；file 副本只读同一个源文件，不修改本地订阅。
  if (automatic && provider.type === "http") {
    copy.path = provider.path
      ? provider.path + ".lean-chain"
      : "./proxies/lean-chain-" + shortHash(name) + ".yaml";
  }
  return copy;
}

// 重复运行时先移除上一次生成的副本。只识别与原始来源完全一致的副本；
// 名称冲突明确报错，不吞掉用户节点。
function stripChainCopies(nodes, providers) {
  const nodeByName = new Map(nodes.map(node => [node.name, node]));
  const keptNodes = nodes.filter(node => {
    if (!node.name.startsWith(CHAIN_COPY.nodePrefix)) return true;
    const original = nodeByName.get(node.name.slice(CHAIN_COPY.nodePrefix.length));
    if (!original || JSON.stringify(node) !== JSON.stringify(copyExitNode(original, true))) {
      throw new Error("Reserved chain copy node name: " + node.name);
    }
    return false;
  });

  const keptProviders = {};
  for (const [name, provider] of Object.entries(providers)) {
    if (!name.startsWith(CHAIN_COPY.providerPrefix)) {
      keptProviders[name] = provider;
      continue;
    }
    const originalName = name.slice(CHAIN_COPY.providerPrefix.length);
    const original = providers[originalName];
    if (!original || JSON.stringify(provider) !== JSON.stringify(copyExitProvider(original, true, originalName))) {
      throw new Error("Reserved chain copy provider name: " + name);
    }
  }
  return { nodes: keptNodes, providers: keptProviders };
}

// 确定前置 / 落地各自使用哪些节点和订阅，并校验。
// 自动模式两者都使用全部来源；手动模式使用 CHAIN_PROXY 中填写的来源。
function resolveChainPools(nodes, providers, automatic) {
  const nodeByName = new Map(nodes.map(node => [node.name, node]));
  let front = CHAIN_PROXY.front;
  let exit = CHAIN_PROXY.exit;

  if (automatic) {
    const all = { nodes: nodes.filter(isProxyNode).map(node => node.name), providers: Object.keys(providers) };
    front = exit = all;
  } else {
    for (const [label, pool] of [["front", front], ["exit", exit]]) {
      const missing = [
        ...pool.nodes.filter(name => !nodeByName.has(name)),
        ...pool.providers.filter(name => !hasOwn(providers, name)),
      ];
      if (missing.length) throw new Error("CHAIN_PROXY." + label + " not found: " + missing.join(", "));
    }
    if (front.nodes.some(name => exit.nodes.includes(name)) ||
        front.providers.some(name => exit.providers.includes(name))) {
      throw new Error("Chain front and exit pools must not overlap.");
    }
  }

  // 前置必须保持未串联，避免副本再拨回自己的前置组。
  if (front.nodes.some(name => nodeByName.get(name)["dialer-proxy"]) ||
      front.providers.some(name => isChainedProvider(providers[name]))) {
    throw new Error("Chain front sources must be unchained.");
  }
  return { front, exit, nodeByName };
}

// 前置 / 落地来源的订阅下载不能依赖链路；落地订阅另外生成串联副本。
function prepareChainProviders(providers, front, exit, automatic) {
  const managed = new Set([...front.providers, ...exit.providers]);
  const result = {};
  for (const [name, original] of Object.entries(providers)) {
    const provider = managed.has(name) && original.type === "http"
      ? { ...original, proxy: CHAIN_PROXY.downloadProxy }
      : original;
    result[name] = provider;
    if (exit.providers.includes(name)) {
      const copyName = automatic ? CHAIN_COPY.providerPrefix + name : name;
      result[copyName] = copyExitProvider(provider, automatic, name);
    }
  }
  return result;
}

// 返回新的节点、订阅以及三类节点池；未启用链式代理时返回 null。
function prepareChain(config) {
  if (!chainEnabled()) return null;
  const automatic = chainAutomatic();
  const input = { nodes: config.proxies || [], providers: config["proxy-providers"] || {} };
  const { nodes, providers } = automatic ? stripChainCopies(input.nodes, input.providers) : input;
  const { front, exit, nodeByName } = resolveChainPools(nodes, providers, automatic);

  const exitCopies = new Map(exit.nodes.map(name => [name, copyExitNode(nodeByName.get(name), automatic)]));
  const exitNodeNames = [...exitCopies.values()].map(node => node.name);
  const exitProviderNames = exit.providers.map(name => automatic ? CHAIN_COPY.providerPrefix + name : name);

  return {
    proxies: automatic
      ? [...nodes, ...exitCopies.values()]
      : nodes.map(node => exitCopies.get(node.name) || node),
    proxyProviders: prepareChainProviders(providers, front, exit, automatic),
    frontPool: explicitPool(front.nodes, front.providers),
    exitPool: explicitPool(exitNodeNames, exitProviderNames),
    normalPool: allNodesPool(
      Object.keys(providers).filter(name => automatic || !exit.providers.includes(name)),
      exitNodeNames,
    ),
  };
}

// ─────────────────────────────────────────────
// 6. DNS 规则集：保留现有 DNS 仍在使用的规则集
// ─────────────────────────────────────────────

function visitObject(value, visit) {
  if (!value || typeof value !== "object") return;
  Object.keys(value).forEach(function (key) {
    visit(key, value[key], value);
    visitObject(value[key], visit);
  });
}

// nameserver-policy 用对象键 "rule-set:a,b"，fake-ip-filter 规则模式用 "RULE-SET,a,..." 字符串。
function collectDnsRuleSetNames(dns) {
  const names = new Set();
  visitObject(dns, function (key, value) {
    if (key.startsWith("rule-set:")) {
      key.slice(9).split(",").forEach(name => names.add(name.trim()));
    }
    if (typeof value === "string" && value.startsWith("RULE-SET,")) {
      names.add(value.split(",")[1].trim());
    }
  });
  return names;
}

// 旧规则集的下载代理如果指向已被本脚本替换的旧代理组，或处于链式模式，就改用安全的下载代理。
function fixPreservedProvider(provider, removedGroups) {
  if (provider.type !== "http") return provider;
  if (chainEnabled() || removedGroups.has(provider.proxy)) {
    return { ...provider, proxy: downloadProxyName() };
  }
  return provider;
}

function preserveDnsRuleProviders(config, ruleProviders, removedGroups) {
  const oldRuleProviders = config["rule-providers"] || {};
  for (const name of collectDnsRuleSetNames(config.dns)) {
    if (!hasOwn(ruleProviders, name) && oldRuleProviders[name]) {
      ruleProviders[name] = fixPreservedProvider(oldRuleProviders[name], removedGroups);
    }
  }
}

// ─────────────────────────────────────────────
// 7. 脚本入口：生成分组和规则，不修改 DNS / TUN 等客户端设置
// ─────────────────────────────────────────────

function main(config) {
  const chain = prepareChain(config);
  const proxyGroups = createProxyGroups(chain);
  const ruleSets = createRuleSets();
  const ruleProviders = createRuleProviders(ruleSets);
  const rules = createRules(ruleSets);
  assertRuleTargets(rules, proxyGroups);

  // 被本脚本替换掉的旧代理组名，用于修正仍被引用的旧规则集。
  const newGroupNames = new Set(proxyGroups.map(group => group.name));
  const removedGroups = new Set(
    (config["proxy-groups"] || []).map(group => group.name).filter(name => !newGroupNames.has(name)),
  );
  preserveDnsRuleProviders(config, ruleProviders, removedGroups);

  if (chain) {
    config.proxies = chain.proxies;
    config["proxy-providers"] = chain.proxyProviders;
  }
  config.mode = "rule";
  config["proxy-groups"] = proxyGroups;
  config["rule-providers"] = ruleProviders;
  config.rules = rules;
  delete config["sub-rules"];
  return config;
}
