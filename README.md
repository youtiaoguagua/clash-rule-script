# Mihomo 精简分流脚本

面向 Mihomo 内核客户端的 JavaScript 覆写脚本。保留节点订阅，重建分组和分流规则，适用于支持 `main(config)` 脚本的 Clash Verge Rev、Mihomo Party 等客户端。

已使用 Mihomo **v1.19.32** 验证。不适用于经典 Clash 内核。脚本依赖较新的 Mihomo 字段，如 `include-all`、`empty-fallback` 和 MRS 规则集。

## 使用

1. 打开订阅对应的 JavaScript 覆写脚本编辑器。
2. 用 [`clash-script.js`](./clash-script.js) 的完整内容替换旧脚本，不要叠加两个分流脚本。
3. 应用配置，确认客户端加载了规则集和下列分组。
4. 在 `US` 分组选择自动测速或一个美国节点；两个 AI 分组默认跟随 `US`。
5. 修改后关闭需要重新选路的旧连接，再验证日志中的策略。

只有 `clash-script.js` 需要导入客户端。测试、文档和 Node.js 不是运行此覆写脚本的前提。

脚本会设置 `mode: rule`，替换原分组、规则集及分流规则，并移除旧的 `sub-rules`。节点名不能与本脚本的分组同名。发现旧 DNS、订阅下载或链式代理引用已删除分组时，脚本会报错，而不是擅自改变链路。

## 分组

| 分组 | 默认选择 / 用途 |
| --- | --- |
| `PROXY` | 默认全节点自动选择，也可选择地区组、负载均衡或单个节点 |
| `US` | 美国节点自动选择，也可手动指定美国节点 |
| `JP` | 日本节点自动选择，也可手动指定日本节点 |
| `SG` | 新加坡节点自动选择，也可手动指定新加坡节点 |
| `load-balance` | 对筛选后的节点使用 `round-robin` 轮询 |
| `Google AI` | 默认 `US`，可独立选择自动测速、`PROXY` 或单个节点 |
| `AI` | 默认 `US`，可独立选择自动测速、`PROXY` 或单个节点 |

六个自动测速子组设置了 `hidden: true`。支持该字段的客户端不会单独显示它们的卡片，但主组内的自动选择选项仍然可用。子组保留在配置中，避免丢失手动 / 自动切换能力。

注意：

- 地区筛选依据节点名称，不检测实际出口国家。
- 自动测速检测 `https://www.gstatic.com/generate_204` 的连通性和延迟，不检测 AI 解锁能力。
- AI 的独立自动组包含全部节点；选择它们可能切换到不适合该服务的出口。
- `load-balance` 额外排除含 `GB`、`Premium`、`ISP` 等标签的节点；如需这些节点，可修改 `NODE_FILTERS.loadBalanceExclude`。
- 筛选后没有节点时使用 `REJECT`，不会静默回退直连。

## 分流顺序

1. 私有域名、已知私有 IP 直连。
2. 自定义域名的拒绝、直连、代理例外。
3. Google AI 与两个 Google 登录端点走 `Google AI`。
4. OpenAI、Anthropic、Copilot、Cursor、Perplexity、xAI、Windsurf、Poe、Mistral、Cohere 走 `AI`。
5. 微软中国大陆 CDN、国内域名直连。
6. Sukka 通用海外域名走 `PROXY`。
7. 国内 IP 直连，并再次检查解析后出现的私有 IP。
8. 其余请求由 `MATCH,PROXY` 兜底。

最后一次私有 IP 检查用于修正这类情况：请求最初只有域名，顶部的 `no-resolve` 规则无法判断；后续 IP 规则解析出内网地址，此时应直连，而不是落到兜底代理。

这项检查不覆盖更早已命中的服务域名规则。需要明确强制某个内网域名直连时，仍建议把它加入自定义直连集合。

## 规则来源

| 来源 | 使用内容 |
| --- | --- |
| [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) | 私有网络、国内域名 / IP、Google AI、服务级 AI 的 MRS 集合 |
| [SukkaW/Surge](https://github.com/SukkaW/Surge) / [ruleset.skk.moe](https://ruleset.skk.moe/) | 微软中国大陆 CDN和通用海外域名，`classical/text` 格式 |
| 本地内联集合 | Google 登录、Microsoft Copilot、Mistral、Cohere 和用户例外 |

远程集合每 86400 秒更新，使用 `PROXY` 下载。每个地址和缓存路径在脚本中完整列出，MRS 与文本规则不会共用缓存文件。第三方规则内容及许可由各自上游项目维护，本仓库不分发缓存数据。

## 自定义

常用修改位置：

- `HEALTH_CHECK`：测速地址、间隔与超时。
- `NODE_FILTERS`：地区名称和排除标签。
- `CUSTOM_DOMAINS`：域名例外。
- `createProxyGroups()`：分组选项，`proxies` 的第一个选项为默认值。
- `createRuleProviders()`：规则来源与格式。
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

## DNS 与内网

脚本不改 DNS、TUN、IPv6、端口、节点参数或凭据。已有 DNS 仍引用的旧规则集会被保留，包括 `nameserver-policy` 和规则模式的 `fake-ip-filter` 依赖。

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
npm test
```

GitHub Actions 只运行语法检查和单元测试，不安装 Mihomo，不访问被测试的 AI 或内网服务。

### 可选 Mihomo 集成测试

集成测试使用本地模拟 DNS、HTTP 代理和 TCP / UDP 服务，验证真实 Mihomo 的分流，不修改系统 DNS、TUN 或网络接口，也不向测试域名发送真实业务请求。

先从 [Mihomo 官方 Releases](https://github.com/MetaCubeX/mihomo/releases) 准备一个可执行内核，再下载测试所需的规则缓存：

```powershell
node scripts/prepare-integration-cache.cjs C:\temp\mihomo-rule-cache

$env:MIHOMO_EXECUTABLE = "C:\tools\mihomo.exe"
$env:MIHOMO_RULE_CACHE = "C:\temp\mihomo-rule-cache"
npm run test:integration
```

这些路径是示例，需换成实际位置。缓存准备脚本只下载规则集，不下载或运行内核。不设置两个环境变量时，集成测试会跳过。

测试夹具与内核日志保存在系统临时目录，便于排查失败。实际节点的可用性和 AI 解锁不在这些模拟测试的验证范围内。

## 项目文件

```text
clash-script.js                       客户端覆写脚本
clash-script.test.cjs                 单元测试
clash-script.integration.test.cjs     可选 Mihomo 实测
scripts/prepare-integration-cache.cjs  规则缓存下载工具
.github/workflows/test.yml            GitHub Actions
```
