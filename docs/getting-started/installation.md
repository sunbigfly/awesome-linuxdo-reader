---
title: 安装与更新
description: 安装 userscript、确认启用状态、理解更新方式并排查入口未出现。
feature_ids: ["CORE-001", "CORE-007", "TROUBLE-001"]
source_anchors: ["@downloadURL", "@match", "DISCOURSE_SITE_ADAPTERS"]
since: 0.1.2
version: 0.1.12
status: current
last_verified: 2026-07-26
screenshots: ["/screenshots/guide-01-reader-overview.png"]
---

# 安装与更新

Awesome LinuxDo Reader 是 userscript，不是独立浏览器扩展。你需要先安装脚本管理器，再从 GreasyFork 安装正式版。

![安装并启用脚本后，LINUX DO 列表页与增强阅读工作区同时可用](/screenshots/guide-01-reader-overview.png)

<p class="image-caption">安装成功并刷新页面后，主题列表仍保留在宿主区域，主题可直接进入右侧增强阅读工作区。</p>

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 站点 | LINUX DO 全面适配；20 个其他社区内置支持；其余标准 HTTPS Discourse 站点可验证后添加 |
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
5. 其他站点可先在任一已支持论坛打开阅读器，通过“设置 → 其他功能 → 自定义站点”输入域名或网址；脚本验证其为 Discourse 后才会保存。
6. 在主题列表顶部或主题链接附近确认阅读器入口已经出现。

::: tip 站点与翻译能力
LINUX DO 保持完整功能覆盖。其他标准 HTTPS Discourse 论坛通过验证后即可使用核心阅读能力，站点未安装的 Boost、Reactions、Post Voting 等插件入口会自动隐藏。已标记为非中文的内置社区还会显示正文翻译按钮。
:::

::: warning 不要同时启用两个版本
正式版、本地调试版或其他同类脚本同时接管主题链接时，可能造成重复入口、重复请求和界面状态冲突。
:::

## 自动更新

脚本元数据包含 GreasyFork 的下载地址和元数据更新地址。更新频率由脚本管理器决定：

- 想立即检查时，在 Tampermonkey 面板中对该脚本执行“检查更新”。
- 更新后刷新当前 Discourse 页面，已打开页面不会自动替换正在运行的旧代码。
- 在“设置 → 关于”或脚本管理器中确认版本；本手册当前对应 `0.1.12`。

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
