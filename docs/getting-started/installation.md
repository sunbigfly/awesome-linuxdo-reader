---
title: 安装与更新
description: 安装 userscript、确认启用状态、理解更新方式并排查入口未出现。
feature_ids: ["CORE-001", "CORE-007", "TROUBLE-001"]
source_anchors: ["lite/userscript.meta.txt","lite/src/app/reader-application.ts"]
since: 0.1.2
version: 1.5.5
status: current
last_verified: 2026-08-17
screenshots: ["/screenshots/guide-01-reader-overview-v1.5.0.png"]
---

# 安装与更新

Awesome LinuxDo Reader 是 userscript，不是独立浏览器扩展。你需要先安装脚本管理器，再从 GreasyFork 安装正式版。

::: tip 当前发布状态
本手册当前对应 `1.5.5`；GitHub 与 Greasy Fork 公开版也已同步到同一 Lite 版本。

- **Loader**：脚本 `588185`，固定版本 `1905077`；Greasy Fork 文件 4,141 字节，SHA-256 `0c1b2ee8c8962326ddac703677cab7672f1d48254948e530ae763a91ea3f6e54`。移除 Greasy Fork 注入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `08cad5236f0780e7010bde7fbf01e373d6595485323c9777c1cf02586a370ab3`，与仓库 Loader 一致。
- **Core**：脚本 `590254`，固定版本 `1905073`；1,578,578 字节，SHA-256 `c800a4ecf7ddbfdf8fa797fe2af91f27e01a0389aff51661af07f348376028b5`。
- **Platform**：脚本 `591595`，固定版本 `1905075`；1,259,412 字节，SHA-256 `22d0870e9882f542b8b4655c64b2e53970d45824359b3ea853ed88960b78a2ba`。
- **Features**：脚本 `590255`，固定版本 `1905074`；1,974,596 字节，SHA-256 `163b9eada11b3ac7b305e11fd5e6fb15cd627fcfaa9248b14fb0e6ca2c361337`。
- **CSS**：固定到 Git `a5bd471c10bf1d40b85e50148c90087489cae584`；612,476 字节，SHA-256 `e3801f8a0c868d101cd0a9d798146b1fc394c82e5535ed9a89b8cf9501f1ed2b`。
:::

![安装并启用脚本后，LINUX DO 列表页与增强阅读工作区同时可用](/screenshots/guide-01-reader-overview-v1.5.0.png)

<p class="image-caption">安装成功并刷新页面后，主题列表仍保留在宿主区域，主题可直接进入右侧增强阅读工作区。</p>

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 站点 | LINUX DO 全面适配；20 个其他社区内置支持；其余标准 HTTPS Discourse 自动识别，深度定制站点可验证添加为兜底 |
| 登录 | 阅读公开内容不一定需要；消息、收藏、回复等能力需要对应账号权限 |
| 脚本管理器 | Tampermonkey 或能够完整支持本脚本权限的兼容管理器 |
| 浏览器能力 | 现代 Chromium、Firefox 或同等级浏览器；具体边界见[兼容性](/reference/compatibility) |

## 安装步骤

1. 安装并启用 Tampermonkey。
2. 打开 [GreasyFork 脚本页](https://greasyfork.org/zh-CN/scripts/588185-awesome-linuxdo-reader)。
3. 选择“安装此脚本”，核对名称为 **Awesome LinuxDo Reader**。
4. 打开或刷新以下任一站点：
   - [LINUX DO](https://linux.do/)
   - [Brave Community](https://community.brave.com/)
   - [Roblox Developer Forum](https://devforum.roblox.com/)
   - [OpenAI Developer Community](https://community.openai.com/)
   - [Home Assistant Community](https://community.home-assistant.io/)
   - [Cfx.re Forum](https://forum.cfx.re/)
   - [Spiceworks Community](https://community.spiceworks.com/)
   - [Arduino Forum](https://forum.arduino.cc/)
   - [Unity Discussions](https://discussions.unity.com/)
   - [Cloudflare Community](https://community.cloudflare.com/)
   - [Epic Developer Community](https://forums.unrealengine.com/)
   - [Obsidian Forum](https://forum.obsidian.md/)
   - [Cursor Community](https://forum.cursor.com/)
   - [Godot Forum](https://forum.godotengine.org/)
   - [n8n Community](https://community.n8n.io/)
   - [MikroTik Forum](https://forum.mikrotik.com/)
   - [Discourse Meta](https://meta.discourse.org/)
   - [Python Discussions](https://discuss.python.org/)
   - [Swift Forums](https://forums.swift.org/)
   - [Julia Discourse](https://discourse.julialang.org/)
   - [Rust Users Forum](https://users.rust-lang.org/)
5. 其他标准 HTTPS Discourse 论坛会自动识别；只有深度定制站点未被识别时，才需在任一可用论坛通过“设置 → 适用站点 → 其他适用站点”验证添加为兼容兜底。
6. 在主题列表顶部或主题链接附近确认阅读器入口已经出现。

::: tip 站点与翻译能力
LINUX DO 保持完整功能覆盖。中文、英文及其他语言的标准 HTTPS Discourse 论坛会被自动识别并启用核心阅读能力，站点未安装的 Boost、Reactions、Post Voting 等插件入口会自动隐藏。站点适配不限内容语言；除内置中文站点 LINUX DO 外，其他 Discourse 社区会显示译为简体中文的正文翻译按钮。
:::

::: warning 不要同时启用两个版本
正式版、本地调试版或其他同类脚本同时接管主题链接时，可能造成重复入口、重复请求和界面状态冲突。
:::

## 自动更新

正式脚本由 GreasyFork 安装后，脚本管理器会记录对应的下载与更新地址；仓库源码不写入
绕过 GreasyFork 的自定义 `updateURL`、`installURL` 或 `downloadURL`。更新频率由脚本管理器决定：

当前公开的 `1.5.5` 主脚本通过固定 `@require` 加载同一发布快照的 Core、Platform 与 Features 三个 Greasy Fork Library。
Library 是正式脚本的一部分，无需单独安装。固定版本 URL 与完整性哈希用于避免更新期间混用不同版本。

- 想立即检查时，在 Tampermonkey 面板中对该脚本执行“检查更新”。
- 更新后刷新当前 Discourse 页面，已打开页面不会自动替换正在运行的旧代码。
- 在“设置 → 关于”或脚本管理器中确认版本为 `1.5.5`；若仍显示旧版，先让脚本管理器检查更新，再完整刷新页面。

## 三种保留版本

| 版本 | 面向对象 | 更新来源 |
| --- | --- | --- |
| GitHub 原版 | 开发者与代码审查者 | `lite/src/`、`lite/styles/` 和构建脚本 |
| 本地测试版 | 发布前手动审查 | 本机单文件 `main-lite.local.js` 与本地四文件 Loader，不会上传；旧 `mian-lite` 拼写保留为兼容副本 |
| Greasy Fork 上传版 | 普通用户 | 当前 `1.5.5` 薄 Loader 固定加载 Core、Platform、Features |

普通用户只安装 Greasy Fork 的 **Awesome LinuxDo Reader** 主脚本。页面上标注“库”的
Core、Platform 和 Features 是当前公开脚本依赖，不应单独安装。

## 入口没有出现

按顺序检查：

1. 当前地址是否位于[明确匹配的站点范围](/reference/compatibility#当前支持范围)。
2. 脚本是否启用，且没有被浏览器的站点访问权限阻止。
3. 页面是否在安装或更新后完整刷新。
4. 是否同时启用了正式版和本地调试版。
5. 是否有其他脚本修改了同一主题列表入口。

仍无法解决时，记录浏览器版本、脚本管理器版本、脚本版本、页面地址的路径部分和可复现步骤；不要提交 Cookie、Authorization、完整页面内容或账号数据。

## 卸载

在脚本管理器中删除或停用脚本即可停止注入。浏览器本地缓存和设置可在卸载前通过“设置 → 数据管理”清理；这只影响阅读器本地数据。
