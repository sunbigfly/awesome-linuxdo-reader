---
title: 安装与更新
description: 安装 userscript、确认启用状态、理解更新方式并排查入口未出现。
feature_ids: ["CORE-001", "CORE-007", "TROUBLE-001"]
source_anchors: ["lite/userscript.meta.txt","lite/src/app/reader-application.ts"]
since: 0.1.2
version: 1.3.0
status: current
last_verified: 2026-08-11
screenshots: ["/screenshots/guide-01-reader-overview-v1.3.0.png"]
---

# 安装与更新

Awesome LinuxDo Reader 是 userscript，不是独立浏览器扩展。你需要先安装脚本管理器，再从 GreasyFork 安装正式版。

::: tip 当前发布状态
Lite `1.3.0` 已发布，普通用户只需安装主脚本。

- **Loader**：脚本 `588185`，固定版本 `1899377`；平台文件 3,815 字节，SHA-256 `cb977d5f6f392d8e99bc5640055bf16be94408fe065900d7ad865dceb777f2f6`。移除 Greasy Fork 注入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `3e4c975eb214efed857992963c59d730ab67c32ea8779d639f278c6ba326bc7b`，与仓库 Loader 一致。
- **Core**：脚本 `590254`，固定版本 `1899370`；1,682,450 字节，SHA-256 `c3ee925dd30dcf7f831fe0e9d393556db9f1fb1429d7e62ba193f9a56dde7b91`。
- **Features**：脚本 `590255`，固定版本 `1899372`；1,839,648 字节，SHA-256 `fa426f71facd50d81e60aa2cb5c7c3ff0a3e11c627d8f372f758b118edbf1345`。
- **CSS**：固定到 Git `5ca40cf3025951dbcb94edde29ebb59083c2bb4f`；472,279 字节，SHA-256 `f438522f298ca3a15363685bd8ef5e33e1a5b17c57e801784018a0fbf418a3b4`。
:::

![安装并启用脚本后，LINUX DO 列表页与增强阅读工作区同时可用](/screenshots/guide-01-reader-overview-v1.3.0.png)

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

v1.0.0 起，主脚本会通过 `@require` 自动加载同一发布版本的两个 Greasy Fork Library；v1.0.1 起，三个 GitHub Webhook 同步源统一使用 canonical `main-lite` 路径。
Library 是正式脚本的一部分，无需单独安装。固定版本 URL 与完整性哈希用于避免更新期间混用不同版本。

- 想立即检查时，在 Tampermonkey 面板中对该脚本执行“检查更新”。
- 更新后刷新当前 Discourse 页面，已打开页面不会自动替换正在运行的旧代码。
- 在“设置 → 关于”或脚本管理器中确认版本；本手册当前对应 `1.3.0`。正式发布后，线上版本应与本页“当前发布状态”一致。

## 三种保留版本

| 版本 | 面向对象 | 更新来源 |
| --- | --- | --- |
| GitHub 原版 | 开发者与代码审查者 | `lite/src/`、`lite/styles/` 和构建脚本 |
| 本地测试版 | 发布前真实页面调试 | 本机 `main-lite.local.js`、`local-debug.user.js` 与验收脚本，不会上传；旧 `mian-lite.local.js` 保留为兼容副本 |
| Greasy Fork 上传版 | 普通用户 | 薄主 Loader 自动加载两个固定版本 Library |

普通用户只安装 Greasy Fork 的 **Awesome LinuxDo Reader** 主脚本。页面上标注“库”的
Core 和 Features 是主脚本依赖，不应单独安装；它们从 GitHub 对应 Raw 文件通过
Webhook 同步，并在发布时固定到已经核验的版本。

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
