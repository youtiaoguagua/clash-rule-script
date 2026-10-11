# Mihomo 精简分流脚本

面向 Mihomo 内核客户端的 JavaScript 覆写脚本。主分流使用客户端本地的完整 `geosite.dat` 和 GeoIP 数据，不再逐项下载 HTTP 规则集。保留节点订阅、地区分组和动态链式代理，适用于支持 `main(config)` 的 Clash Party、Mihomo Party、Clash Verge Rev 等客户端。

不适用于经典 Clash 内核。脚本依赖 Mihomo 的 `GEOSITE`、`include-all` 和 `empty-fallback` 等功能。

## 使用

1. 打开订阅对应的 JavaScript 覆写脚本编辑器。
2. 用 [`clash-script.js`](./clash-script.js) 的完整内容替换旧脚本，不要叠加两个分流脚本。
3. 确认客户端已有完整的 GeoSite 数据；若版本过旧，先在客户端更新 Geo 数据，再应用配置。
4. 在 `US` 分组选择自动测速或一个美国节点；两个 AI 分组默认跟随 `US`。
5. 修改后关闭需要重新选路的旧连接，再验证日志中的策略。

只有 `clash-script.js` 需要导入客户端，Node.js 不是运行覆写脚本的前提。

脚本会设置 `mode: rule`，替换原分组和主分流规则，并移除旧的 `sub-rules`。旧 `rule-providers` 只有在 DNS 仍引用时才保留。节点名不能与脚本分组同名；旧设置若引用被删除的分组，需要自行调整。

链式部分保留副本名称、来源存在 / 不重叠、前置未串联等必要检查，规则目标也需存在。字段类型、节点重名、DNS 引导和下载代理不做穷举预检；配置错误查看客户端脚本或内核日志。

## Geo 数据

- 使用完整的 `geosite.dat`，例如 MetaCubeX 的完整版本。需要包含 `private`、`cn`、`geolocation-!cn`、`google-gemini`、`openai`、`anthropic` 等服务分类；分类缺失会导致内核配置加载失败。
- `geodata-mode: false` 使用 MMDB 判断 GeoIP；`true` 使用 `geoip.dat`。脚本不改变客户端现有的模式。
- 不改 `geox-url`、Geo 自动更新开关或更新间隔，Geo 文件仍由客户端管理。已有完整文件时直接读取，不再触发原先那批 HTTP rule-provider 的初始化。
- 这减少了主分流的下载源数量，但不能证明原来的失败是限流，也不保证首次下载和 Geo 更新永远成功。

## 分组

| 分组 | 默认选择 / 用途 |
| --- | --- |
| `PROXY` | 默认原节点自动选择，也可选择地区组、负载均衡、原节点或统一的“链式代理”入口；不逐个列出落地副本 |
| `US` | 美国节点自动选择，也可手动指定美国节点 |
| `JP` | 日本节点自动选择，也可手动指定日本节点 |
| `SG` | 新加坡节点自动选择，也可手动指定新加坡节点 |
| `load-balance` | 对筛选后的节点使用 `round-robin` 轮询 |
| `Google AI` | 默认 `US`，可独立选择自动测速、`PROXY` 或单个节点 |
| `AI` | 默认 `US`，可独立选择自动测速、`PROXY` 或单个节点 |
| `前置代理` | 链式连接第一跳，使用当前订阅的原始节点 |
| `链式代理` | 链式连接第二跳，使用当前订阅节点的独立落地副本 |

默认六个自动测速子组设置了 `hidden: true`，关闭链式功能后剩四个。两个 AI 组复用全节点的“自动选择”。支持隐藏字段的客户端不会单独显示子组卡片，但主组内仍可手动 / 自动切换。

注意：

- 地区筛选依据节点名称，不检测实际出口国家。
- 自动测速检测 `https://www.gstatic.com/generate_204` 的连通性和延迟，不检测 AI 解锁能力。
- 全节点自动选择不检测 AI 解锁；两个 AI 组选它时可能切换到不适合该服务的出口。
- `load-balance` 额外排除流量数字中的 `GB`、`Premium` 和独立的 `ISP` 标签；可修改 `NODE_FILTERS.loadBalanceExclude`。
- 筛选后没有节点时使用 `REJECT`，不会静默回退直连。

## 分流顺序

1. 私有域名、已知私有 IP 直连。
2. 自定义域名的拒绝、直连、代理例外。
3. Google AI 与两个 Google 登录端点走 `Google AI`。
4. OpenAI、Anthropic、Copilot、Cursor、Perplexity、xAI、Windsurf、Poe、Mistral、Cohere 走 `AI`。
5. 常用微软下载域名、`microsoft@cn` 和 `cn` 分类直连。
6. `geolocation-!cn` 分类走 `PROXY`。
7. `GEOIP,CN,DIRECT` 处理国内裸 IP，并再次检查解析后出现的私有 IP。
8. 其余请求由 `MATCH,PROXY` 兜底。

最后一次私有 IP 检查用于修正这类情况：请求最初只有域名，顶部的 `no-resolve` 规则无法判断；后续 IP 规则解析出内网地址，此时应直连，而不是落到兜底代理。

GeoIP 使用客户端的地理数据库，不再依赖远程 CN provider。它只处理前面尚未匹配的连接，不覆盖明确的 AI 或自定义代理规则。

这项检查不覆盖更早已命中的服务域名规则。需要明确强制某个内网域名直连时，仍建议把它加入自定义直连集合。

## 规则来源

| 来源 | 使用内容 |
| --- | --- |
| 客户端完整 GeoSite 数据（推荐 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)） | 私有域名、国内域名、Google AI、服务级 AI、海外分类 |
| 客户端 GeoIP 数据 | 国内及私有 IP；沿用 MMDB / DAT 模式 |
| 脚本内直接域名规则 | Google 登录、Microsoft Copilot、Mistral、Cohere、常用微软下载和用户例外 |

不再下载 Sukka 的 `microsoft_cdn.txt` 和 `global.txt`。它们分别替换为明确的常用下载域名 / `microsoft@cn`，以及 `geolocation-!cn`；这些分类与 Sukka 集合并不保证完全等价。不在仓库分发 Geo 数据文件。

默认生成的主分流没有 `rule-provider`。如果你的 DNS 使用 `rule-set:` 或 `RULE-SET` 引用旧集合，脚本仍保留订阅中对应的定义，这些依赖可能继续下载；不能为了删干净而破坏 DNS。机场节点的 `proxy-providers` 也仍然保留。

## 自定义

常用修改位置：

- `HEALTH_CHECK`：测速地址、间隔与超时。
- `NODE_FILTERS`：地区名称和排除标签。
- `CUSTOM_DOMAINS`：域名例外。
- `CHAIN_PROXY`：链式功能开关、自动 / 手动来源与下载引导方式。
- `createProxyGroups()`：分组选项，`proxies` 的第一个选项为默认值。
- `createRules()`：分流优先级。

自定义例外默认为空。例如：

```js
const CUSTOM_DOMAINS = {
  direct: ["router.home.arpa", "+.home.arpa"],
  proxy: ["need-proxy.example.com"],
  reject: ["blocked.example.com"],
};
```

`"example.com"` 只匹配该域名，`"+.example.com"` 同时匹配它及其子域名。实际使用时替换这些示例，并保留已有条目。

## 动态链式代理

默认启用 `enabled: true, mode: "auto"`，不用手填节点或 provider 名称。完整替换客户端的旧脚本并应用配置后，即可看到 `前置代理` 和 `链式代理`。

`mode` 只决定节点池的来源：`auto` 使用当前订阅，`manual` 使用指定来源。**两种模式都保留界面中的手动选节点和自动测速选项**，不需要为了切换前置 / 落地而编辑脚本。

```text
设备 → 前置代理当前选中的节点 → 链式代理当前选中的落地节点 → 网站
```

可以分别切换前置与落地，不必给每个落地写死某个前置节点。切换影响新连接，已有连接需要关闭后重连。

### 直接使用当前订阅

1. 在 `前置代理` 中选择当前订阅的节点 A，例如新加坡节点。
2. 在 `链式代理` 中选择 `链式落地 | 节点 B`，例如美国节点。
3. 在 `PROXY`、`Google AI` 或 `AI` 中选择 `链式代理`，对应流量才会经过两跳。
4. 后续直接在界面切换 A 或 B，不用再次编辑脚本；关闭旧连接后验证新链路。

原始节点不增加 `dialer-proxy`，普通代理及地区组继续使用它们。脚本为每个原始代理节点生成带 `链式落地 | ` 前缀的副本，副本通过 `前置代理` 拨号，只进入链式分组。

如果订阅使用 `proxy-providers`，脚本为每个 provider 生成 `lean-chain-exit:` 副本，保留原 URL、筛选和名称覆写，并添加落地前缀及前置引用。HTTP 副本使用独立缓存；文件副本读取同一个源文件；内联副本使用同一份节点数据。HTTP 落地池刷新后，新节点自动获得链式设置，无需逐个编辑脚本。原池和副本独立刷新，节点列表可能短暂不同步。

**请选择不同的前置与落地节点。** 两个自动选择不会互相避让，可能选到同一服务器；这不构成配置引用循环，但是否能连接取决于服务端，通常也没有两跳的实际收益。节点名称不同也不一定代表不同服务器。

功能默认可见，但 `PROXY` 仍默认普通自动选择，两个 AI 组仍默认 `US`，不会自动把所有流量改成链式。添加分组也不会把机场出口变成住宅 IP，出口性质仍由落地节点决定。

### 手动指定来源（高级）

如果有独立的机场入口与住宅落地来源，可使用手动模式，按实际节点名称填写：

```js
const CHAIN_PROXY = {
  enabled: true,
  mode: "manual",
  front: { providers: [], nodes: ["机场 SG 1", "机场 HK 2"] },
  exit: { providers: [], nodes: ["住宅 US 1", "住宅 US 2"] },
  downloadProxy: "DIRECT",
};
```

如果私有配置已定义 `proxy-providers`，按其键名填写：

```js
const CHAIN_PROXY = {
  enabled: true,
  mode: "manual",
  front: { providers: ["机场节点池"], nodes: [] },
  exit: { providers: ["住宅落地池"], nodes: [] },
  downloadProxy: "DIRECT",
};
```

两种来源可以混合。这里的 provider 名称是最终配置中 `proxy-providers` 的键，**不是客户端界面上的订阅名称**。若订阅已经展开成静态节点，就使用 `nodes`。

手动模式下，指定落地来源直接获得 `dialer-proxy: 前置代理`，不另建副本，并从普通池中移除；前置和落地来源不能重叠。provider 更新后，新落地自动获得前置引用。若普通 US 节点因此为空，AI 主组应手动选择 `链式代理`。两种模式均要求原订阅中的节点名称唯一；不同订阅可在私有 provider 配置中设置名称前缀。

### 隔离与引导

- 自动模式的原池与落地副本隔离；手动模式的两个来源不得重叠。
- 普通分组不包含链式落地副本 / 手动指定的落地节点，避免不选择链式模式也意外经过前置。
- 保留订阅 URL、凭据和已有名称前缀；自动模式为落地副本额外添加名称前缀。
- `downloadProxy` 只控制角色 HTTP 节点订阅和 DNS 仍引用的旧 HTTP 规则集，默认 `DIRECT`，不控制 Geo 文件更新。
- 如果这些地址不能直连，可填写一个现有、未串联、非落地的**静态节点名称**，避免下载依赖正在建立的链式分组。
- DNS 不会被自动更改，也不再校验引导方式。开启 `dns.respect-rules` 时应自行配置独立的 `proxy-server-nameserver`；避免节点 DNS 再依赖这些代理分组或 `#RULES`。
- 前置故障时连接失败，不会偷偷绕过前置直连落地。

使用不含链式引用的入口 / 落地来源。对 HTTP / 文件 provider，脚本不能预先检查远端文件内所有节点的既有链式设置；不要把已经串联的远端节点池再次交给本功能。

provider 的 `proxy-name`、前后缀及 `override-expr` 都保留，不再禁止高级表达式。自行确保表达式不会覆盖生成的落地名称和 `dialer-proxy`，否则可能破坏隔离或改变链路。`链式落地 | ` 与 `lean-chain-exit:` 是生成副本的保留前缀，请勿用于原始节点 / provider 名称。

关闭功能只需从原始订阅重新生成，并设置 `enabled: false`。不要把含有生成后 `dialer-proxy` 的配置当作原始来源，再单纯关闭开关，否则会残留指向链式分组的引用。

**已实测 HTTP 前置 → HTTP 落地的 TCP 链、动态切换，以及 HTTP / 文件 provider 刷新；覆盖静态、HTTP、文件和内联来源。UDP / QUIC 是否可链式工作取决于两跳协议与节点能力，不保证所有组合支持，也没有默认禁用 UDP。**

公开仓库只放编排代码。真实订阅、住宅代理账号和密码放在客户端的私有配置中，不要提交到 GitHub。

## DNS 与内网

脚本不改 DNS、TUN、IPv6、端口或凭据。自动模式不改原始节点参数，只添加落地副本和相关下载代理；手动模式设置指定落地的前置引用。已有 DNS 仍引用的旧规则集会被保留，包括 `nameserver-policy` 和规则模式的 `fake-ip-filter` 依赖。

内网服务需要同时满足：

- 域名解析到可达的内网地址。
- 请求命中直连规则。
- A / AAAA 记录符合预期；仅把 IPv4 重写成内网地址，并不会消除公网 IPv6 入口。

必要时为具体域名添加 `CUSTOM_DOMAINS.direct`，并在 DNS 配置中使用 `nameserver-policy` 指向可达的内网 DNS。这里没有预置私有 DNS 地址，也不按 Wi-Fi 名称自动切换配置。

客户端的 DNS 覆写可能再次修改最终 DNS 设置。不要在多处配置相互冲突的 DNS 策略。

## 开发与测试

建议使用 Node.js 24，最低要求 Node.js 22。无 npm 运行依赖，无需安装 `node_modules`。

```sh
npm run check
```

语法检查不能代替内核验证；内核还需要读取 Geo 文件、检查分类存在并解析最终 YAML。可以用 Mihomo 的 `-t` 检查生成配置，再验证实际连接日志。旧的 HTTP 规则缓存准备工具和测试文件已不在本仓库中。

## 项目文件

```text
clash-script.js  客户端覆写脚本
README.md        使用说明
package.json     语法检查命令
```
