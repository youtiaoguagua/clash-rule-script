# Mihomo / Clash 覆写与分流脚本

针对 **Clash Party / Mihomo Party / Clash Verge Rev** 设计的精简覆写脚本，原生支持 **Sub-Store** 脚本转换与 **GitHub Actions** 自动构建。

---

## ✨ 核心特性

- **全局受控**：`AI`、`Google AI` 等业务分组默认跟随主 `PROXY` 组。切一次主代理，全部分组生效。
- **动态链式代理**：无需手动配置，自动生成前置与落地节点池（`前置代理 -> 链式代理`），突破特定网络限制。
- **原生 Geo 分流**：纯本地 `GEOSITE` 与 `GEOIP` 二进制规则，包含常见广告与追踪拦截（`category-ads-all`），零远程规则集下载开销。
- **防 DNS 冲突与泄露**：强制清理订阅原有的杂乱 `dns` 配置，完全交由客户端（如 Clash Party）的 DNS 覆盖接管；国内 IP 规则配合 `no-resolve` 避免 DNS 泄露。

---

## 🚀 使用方法

### 方式一：在 Clash Party / Mihomo Party / Clash Verge Rev 中使用

1. 打开客户端的 **配置/订阅覆写 (Script / Override)** 界面。
2. 新建脚本，将 [`clash-script.js`](./clash-script.js) 的全部内容复制粘贴进去。
3. 保存并激活覆写，更新订阅即可。

### 方式二：在 Sub-Store 中使用

仓库已自动生成适配 Sub-Store 的脚本文件 [`substore-script.js`](./substore-script.js)。

1. 打开 Sub-Store 界面，进入目标订阅。
2. 添加 **脚本操作 (Script)**：
   - 脚本地址填入你的 GitHub Raw 地址：
     ```text
     https://raw.githubusercontent.com/youtiaoguagua/clash-rule-script/main/substore-script.js
     ```
3. 保存后生成订阅节点。

---

## 🛠️ 关键功能说明

### 1. 业务分流与 AI
- **默认行为**：`AI` 和 `Google AI` 分组第一选项均为 `PROXY`。当你切换主 `PROXY` 组的节点时，AI 流量会自动跟随。
- **独立选择**：若特定服务需要固定出口（例如 ChatGPT/Claude 要求纯净出口），可在界面上将 `AI` 组单独切至 `US`、`自动选择` 或 `链式代理`。

### 2. 链式代理（中转 / 落地）
脚本默认开启 `auto` 链式代理模式：
- **前置代理**：使用订阅内的原节点作为中转前置节点（支持手动选择或前置自动测速）。
- **链式代理**：自动将订阅节点生成串联副本并绑定 `dialer-proxy`，在界面上只需选中 `链式代理` 即可享受链式中转加速。

---

## 🤖 自动化工作流

本项目配置了 GitHub Actions（`.github/workflows/generate-substore.yml`）：
- 每次修改并推送 `clash-script.js` 后，工作流会自动生成对应的 `substore-script.js` 并提交推送，无需手动维护两份文件。
