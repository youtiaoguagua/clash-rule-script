// Clash Verge Rev 覆写脚本，需要较新的 Mihomo 内核。
// 用完整文件替换旧脚本，不要把两个分流脚本叠加运行。
// 只替换分流规则和分组，不修改 DNS、TUN、端口、订阅地址或节点参数。
// US 按节点名称筛选，不检测实际出口国家，也不保证 AI 服务可用。
// 主规则只用 RULE-SET 和最终的 MATCH，远程规则集每天更新。

// 1. 常用设置

const RULE_UPDATE_INTERVAL = 86400; // 规则集更新间隔，单位为秒。
const URL_TEST_TOLERANCE = 50; // 延迟差在 50 ms 内时，不频繁切换节点。

const HEALTH_CHECK = {
  url: "https://www.gstatic.com/generate_204",
  interval: 300, // 检查间隔，单位为秒。
  timeout: 5000, // 超时时间，单位为毫秒。
  lazy: true,
  "expected-status": "204",
};

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
  exclude:
    "(?i)(官网|官網|套餐|剩余|剩餘|流量|到期|过期|過期|有效期|" +
    "重置|traffic|expire|\\b(official|website|renewal|reset)\\b|" +
    "^(DIRECT|REJECT(-DROP)?|COMPATIBLE|PASS|DNS)$)",
  // 负载均衡额外排除订阅提示、Premium 和 ISP 标签。
  loadBalanceExclude:
    "(?i)(GB|Traffic|Expire|Premium|频道|订阅|ISP|流量|到期|重置|" +
    "官网|官網|套餐|剩余|剩餘|过期|過期|有效期|\\b(official|website|renewal|reset)\\b|" +
    "^(DIRECT|REJECT(-DROP)?|COMPATIBLE|PASS|DNS)$)",
};

// 自定义域名例外，默认不额外直连或拦截任何服务。
// "example.com" 仅匹配该域名，"+.example.com" 同时匹配它及其子域名。
const CUSTOM_DOMAINS = {
  direct: [],
  proxy: [],
  reject: [],
};

// 2. 节点分组：proxies 中的第一个选项就是默认选择。

function createProxyGroups() {
  return [
    // 总入口含全部节点；不加入 AI 分组，避免相互引用。
    selectGroup({
      name: "PROXY",
      proxies: ["自动选择", "US", "JP", "SG", "load-balance"],
    }),
    // 地区组同时提供该地区的自动选择和单个节点。
    selectGroup({ name: "US", proxies: ["US 自动选择"], filter: NODE_FILTERS.us }),
    selectGroup({ name: "JP", proxies: ["JP 自动选择"], filter: NODE_FILTERS.jp }),
    selectGroup({ name: "SG", proxies: ["SG 自动选择"], filter: NODE_FILTERS.sg }),
    urlTestGroup({ name: "自动选择" }),
    loadBalanceGroup({ name: "load-balance" }),
    // AI 默认仍走 US，也可独立选择全节点自动测速。
    selectGroup({ name: "Google AI", proxies: ["US", "Google AI 自动选择", "PROXY"] }),
    selectGroup({ name: "AI", proxies: ["US", "AI 自动选择", "PROXY"] }),

    // 自动测速子组只包含节点，不引用上层分组；隐藏独立卡片，保留主组内的选项。
    urlTestGroup({ name: "US 自动选择", filter: NODE_FILTERS.us }),
    urlTestGroup({ name: "JP 自动选择", filter: NODE_FILTERS.jp }),
    urlTestGroup({ name: "SG 自动选择", filter: NODE_FILTERS.sg }),
    urlTestGroup({ name: "Google AI 自动选择" }),
    urlTestGroup({ name: "AI 自动选择" }),
  ];
}

// 3. 规则集：保留完整 URL，方便单独替换来源。
// MetaCubeX 使用 domain/ipcidr + mrs，Sukka 使用 classical + text。

function createRuleProviders() {
  return {
    // 自定义例外优先于下面的外网服务规则，不会改变私有网络规则。
    "lean-custom-reject": inlineDomainProvider(CUSTOM_DOMAINS.reject),
    "lean-custom-direct": inlineDomainProvider(CUSTOM_DOMAINS.direct),
    "lean-custom-proxy": inlineDomainProvider(CUSTOM_DOMAINS.proxy),

    // 局域网及私有域名。
    "lean-private-domain": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/private.mrs",
      path: "./ruleset/lean-ai/geosite-private.mrs",
      behavior: "domain",
    }),
    // 私有 IP 网段。
    "lean-private-ip": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.mrs",
      path: "./ruleset/lean-ai/geoip-private.mrs",
      behavior: "ipcidr",
    }),
    // Google AI。
    "lean-google-ai": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google-gemini.mrs",
      path: "./ruleset/lean-ai/geosite-google-gemini.mrs",
      behavior: "domain",
    }),
    // 只补充两个共享登录域名，不把全部 Google 域名分到 AI 组。
    "lean-google-ai-login": inlineDomainProvider([
      "accounts.google.com",
      "oauth2.googleapis.com",
    ]),

    // AI 使用服务级集合，不再使用 category-ai-!cn 大分类。
    "lean-openai": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.mrs",
      path: "./ruleset/lean-ai/geosite-openai.mrs",
      behavior: "domain",
    }),
    "lean-anthropic": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/anthropic.mrs",
      path: "./ruleset/lean-ai/geosite-anthropic.mrs",
      behavior: "domain",
    }),
    "lean-github-copilot": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github-copilot.mrs",
      path: "./ruleset/lean-ai/geosite-github-copilot.mrs",
      behavior: "domain",
    }),
    // 使用少量明确的域名补充，不把整个微软或 Bing 分到 AI。
    "lean-microsoft-copilot": inlineDomainProvider([
      "+.copilot.microsoft.com",
      "+.copilot.cloud.microsoft",
      "+.copilot.com",
      "+.copilot-stg.com",
    ]),
    "lean-cursor": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cursor.mrs",
      path: "./ruleset/lean-ai/geosite-cursor.mrs",
      behavior: "domain",
    }),
    "lean-perplexity": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/perplexity.mrs",
      path: "./ruleset/lean-ai/geosite-perplexity.mrs",
      behavior: "domain",
    }),
    "lean-xai": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/xai.mrs",
      path: "./ruleset/lean-ai/geosite-xai.mrs",
      behavior: "domain",
    }),
    "lean-windsurf": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/windsurf.mrs",
      path: "./ruleset/lean-ai/geosite-windsurf.mrs",
      behavior: "domain",
    }),
    "lean-poe": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/poe.mrs",
      path: "./ruleset/lean-ai/geosite-poe.mrs",
      behavior: "domain",
    }),
    "lean-mistral": inlineDomainProvider(["+.mistral.ai"]),
    "lean-cohere": inlineDomainProvider(["+.cohere.ai", "+.cohere.com"]),

    // 微软的大陆 CDN 直连；不包含全微软直连或遥测拦截。
    "lean-microsoft-cdn": ruleProvider({
      url: "https://ruleset.skk.moe/Clash/non_ip/microsoft_cdn.txt",
      path: "./ruleset/lean-ai/sukka-microsoft-cdn.txt",
      behavior: "classical",
      format: "text",
    }),
    // 国内域名优先于通用海外集合。
    "lean-cn-domain": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs",
      path: "./ruleset/lean-ai/geosite-cn.mrs",
      behavior: "domain",
    }),
    // Sukka 通用海外服务集合，仍需放在明确的直连例外之后。
    "lean-proxy-domain": ruleProvider({
      url: "https://ruleset.skk.moe/Clash/non_ip/global.txt",
      path: "./ruleset/lean-ai/sukka-global.txt",
      behavior: "classical",
      format: "text",
    }),
    // 国内 IP 网段。
    "lean-cn-ip": ruleProvider({
      url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs",
      path: "./ruleset/lean-ai/geoip-cn.mrs",
      behavior: "ipcidr",
    }),
  };
}

// 4. 分流顺序：从上往下匹配，先匹配的规则生效。

function createRules() {
  return [
    "RULE-SET,lean-private-domain,DIRECT",
    "RULE-SET,lean-private-ip,DIRECT,no-resolve",

    // 只有手动填入 CUSTOM_DOMAINS 的域名才受这些例外影响。
    "RULE-SET,lean-custom-reject,REJECT",
    "RULE-SET,lean-custom-direct,DIRECT",
    "RULE-SET,lean-custom-proxy,PROXY",

    // 服务级 AI 规则优先于普通服务直连规则。
    "RULE-SET,lean-google-ai,Google AI",
    "RULE-SET,lean-google-ai-login,Google AI",
    "RULE-SET,lean-openai,AI",
    "RULE-SET,lean-anthropic,AI",
    "RULE-SET,lean-github-copilot,AI",
    "RULE-SET,lean-microsoft-copilot,AI",
    "RULE-SET,lean-cursor,AI",
    "RULE-SET,lean-perplexity,AI",
    "RULE-SET,lean-xai,AI",
    "RULE-SET,lean-windsurf,AI",
    "RULE-SET,lean-poe,AI",
    "RULE-SET,lean-mistral,AI",
    "RULE-SET,lean-cohere,AI",

    // 域名直连例外在海外集合前，国内 IP 兜底仍在海外集合后。
    "RULE-SET,lean-microsoft-cdn,DIRECT",
    "RULE-SET,lean-cn-domain,DIRECT",
    "RULE-SET,lean-proxy-domain,PROXY",
    "RULE-SET,lean-cn-ip,DIRECT",
    // 上一条 IP 规则已触发解析，再检查私有 IP，避免内网域名落入代理兜底。
    "RULE-SET,lean-private-ip,DIRECT,no-resolve",
    "MATCH,PROXY",
  ];
}

// 5. 通用构建函数：统一默认参数，通常不需要修改。

function ruleProvider({ url, path, behavior, format = "mrs" }) {
  return {
    type: "http",
    behavior,
    format,
    url,
    path,
    interval: RULE_UPDATE_INTERVAL,
    proxy: "PROXY",
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

function selectGroup({ name, proxies, filter }) {
  const group = {
    name,
    type: "select",
    "include-all": true,
    "exclude-filter": NODE_FILTERS.exclude,
    "exclude-type": "Direct|Reject|RejectDrop|Compatible|Pass|Dns",
    // 没有候选节点时拒绝连接，不意外回退为直连。
    "empty-fallback": "REJECT",
  };
  if (proxies) group.proxies = proxies;
  if (filter) group.filter = filter;
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

function loadBalanceGroup({ name }) {
  return {
    ...selectGroup({ name }),
    ...HEALTH_CHECK,
    type: "load-balance",
    strategy: "round-robin",
    "exclude-filter": NODE_FILTERS.loadBalanceExclude,
  };
}

// 6. 兼容检查：保留 DNS 依赖，并在失效引用或循环代理时明确报错。

function visitObject(value, visit) {
  if (!value || typeof value !== "object") return;
  Object.keys(value).forEach(function (key) {
    visit(key, value[key]);
    visitObject(value[key], visit);
  });
}

function validateSubscription(config, proxyGroups) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Expected a subscription config object.");
  }
  const nodes = Array.isArray(config.proxies) ? config.proxies : [];
  const providers = config["proxy-providers"] || {};
  if (nodes.length === 0 && Object.keys(providers).length === 0) {
    throw new Error("No proxies or proxy-providers found in the subscription.");
  }

  const groupNames = proxyGroups.map(function (group) { return group.name; });
  nodes.forEach(function (node) {
    if (groupNames.includes(node.name)) {
      throw new Error("Rename the node conflicting with a group: " + node.name);
    }
  });
}

function preserveDnsRuleProviders(config, ruleProviders) {
  // 仅保留现有 DNS 设置仍在引用的旧规则集。
  const oldRuleProviders = config["rule-providers"] || {};
  visitObject(config.dns, function (key, value) {
    // nameserver-policy 用对象键，fake-ip-filter 规则模式用 RULE-SET 字符串。
    const names = key.startsWith("rule-set:") ? key.slice(9).split(",") : [];
    if (typeof value === "string" && value.startsWith("RULE-SET,")) {
      names.push(value.split(",")[1]);
    }
    names.forEach(function (name) {
      name = name.trim();
      if (Object.prototype.hasOwnProperty.call(ruleProviders, name)) return;
      if (!Object.prototype.hasOwnProperty.call(oldRuleProviders, name)) {
        throw new Error("DNS references a missing rule provider: " + name);
      }
      ruleProviders[name] = oldRuleProviders[name];
    });
  });
}

function validateGroupReferences(config, proxyGroups, ruleProviders) {
  // 删除旧分组后，若订阅或链式代理仍引用它们则报错，不擅自改动链路。
  const groupNames = proxyGroups.map(function (group) { return group.name; });
  const oldGroups = (config["proxy-groups"] || []).map(function (group) {
    return group.name;
  });
  const removedGroups = oldGroups.filter(function (name) {
    return !groupNames.includes(name);
  });
  function checkReferences(key, value) {
    if (typeof value !== "string") return;
    if ((key === "proxy" || key === "dialer-proxy") &&
        removedGroups.includes(value)) {
      throw new Error("Update " + key + " referencing removed group: " + value);
    }
    if (key === "dialer-proxy" && groupNames.includes(value)) {
      throw new Error("A node's dialer-proxy cannot use an include-all group: " + value);
    }
  }
  const replacedFields = ["rules", "proxy-groups", "rule-providers", "sub-rules"];
  Object.keys(config).forEach(function (key) {
    if (!replacedFields.includes(key)) {
      visitObject(config[key], checkReferences);
    }
  });
  visitObject(ruleProviders, checkReferences);
  // 只检查 DNS 地址中的分组参数；节点密码可以合法包含 "#Old"。
  visitObject(config.dns, function (key, value) {
    if (typeof value !== "string") return;
    value.split("#").slice(1).forEach(function (fragment) {
      fragment.split("&").forEach(function (part) {
        let name = part;
        try { name = decodeURIComponent(part); } catch (_) { /* 不是有效的 URL 编码。 */ }
        if (removedGroups.includes(name)) {
          throw new Error("Update DNS referencing removed group: " + name);
        }
      });
    });
  });
}

// 7. 脚本入口：先构建和检查，再一次性替换分流配置。

function main(config) {
  const proxyGroups = createProxyGroups();
  validateSubscription(config, proxyGroups);

  const ruleProviders = createRuleProviders();
  preserveDnsRuleProviders(config, ruleProviders);
  validateGroupReferences(config, proxyGroups, ruleProviders);

  config.mode = "rule";
  config["proxy-groups"] = proxyGroups;
  config["rule-providers"] = ruleProviders;
  config.rules = createRules();
  delete config["sub-rules"];
  return config;
}
