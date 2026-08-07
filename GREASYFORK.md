<p align="center">
  <img src="https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/logo.png" alt="Awesome LinuxDo Reader" width="320">
</p>

# Awesome LinuxDo Reader

为 LINUX DO 深度定制并保持完整功能覆盖，同时通过站点识别与能力检测兼容中文、英文及其他语言的标准 Discourse 社区，在列表页内完成阅读、翻译、回复与原站互动。

[安装脚本](https://update.greasyfork.org/scripts/588185/Awesome%20LinuxDo%20Reader.user.js) · [在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/) · [GitHub 项目](https://github.com/sunbigfly/awesome-linuxdo-reader) · [问题反馈](https://github.com/sunbigfly/awesome-linuxdo-reader/issues)

![在 LINUX DO 列表页右侧打开完整增强阅读工作区](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-01-reader-overview-v1.0.0.png)

## 功能

- LINUX DO 全面适配，消息、历史、收藏、回应、Boost、长帖与楼层关系等能力保持完整覆盖。
- 中文、英文及其他语言的标准 Discourse 站点均可使用；插件、主题和权限差异由站点适配层与能力检测自动降级。
- 列表页直接打开完整帖子，支持浮窗、全屏与移动端布局。
- 保留楼层关系、楼中楼、跳转、浏览历史与真实已读进度。
- 集成回复、点赞、回应、收藏、通知、搜索与用户资料等社区能力。
- 为非中文内置社区提供原文、双语与全译文切换，并集成原图灯箱、媒体播放和公式渲染。
- 内置 21 个社区；其他 HTTPS Discourse 论坛可验证后添加，非 Discourse 网站不会启动。
- 内置请求调度、429 退避、DOM 窗口化与本地资源监控。

## 核心体验

| 看图灯箱 | 消息中心 | 请求流与 429 控制 |
| --- | --- | --- |
| ![在阅读器内查看帖子原图、图片序列和关联评论](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-19-image-lightbox-v1.0.0.png) | ![查看消息中心的回复分类和真实通知](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-15-notifications-replies-v1.0.0.png) | ![查看请求调度、限流边界和异常恢复状态](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-11-request-flow-v1.0.0.png) |
| 原图、图片序列与关联评论。 | 回复、点赞、私信与内容回跳。 | 共享账本、排队放行与退避恢复。 |

## 安装

> **发布状态：** GitHub 源码、用户手册与 Greasy Fork 脚本 588185 均已发布 Lite `1.0.1`。正式主脚本固定版本为 `1895932`，是 3,794 字节薄 Loader，固定加载 Core `1895921` 与 Features `1895924`；两个 Library 均带已核验的 SHA-256。

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)、Violentmonkey 或兼容的 userscript 管理器。
2. 在本页点击“安装此脚本”。
3. 打开或刷新以下任一站点：
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
4. 其他 HTTPS Discourse 论坛可在阅读器“设置 → 适用站点 → 其他适用站点”中验证并添加。
5. 点击主题标题开始使用。

当前项目版本为 `1.0.1`。除内置中文站点 LINUX DO 外，其他内置社区和语言未知的自定义 Discourse 站点还支持原文、双语和简体中文译文切换；完整范围、翻译边界和能力降级规则见[兼容性说明](https://sunbigfly.github.io/awesome-linuxdo-reader/reference/compatibility)。

1.0.1 将工程、产物与 Webhook 同步路径无损正名为 `main-lite`，同时保留旧 `mian-lite` 兼容别名；1.0.0 完成的 Lite 模块化与三文件架构保持不变。完整列表见[更新记录](https://sunbigfly.github.io/awesome-linuxdo-reader/reference/changelog)。

## 文档与支持

[正式用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/) · [GitHub 项目](https://github.com/sunbigfly/awesome-linuxdo-reader) · [问题反馈](https://github.com/sunbigfly/awesome-linuxdo-reader/issues)

许可证：[MIT License](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/LICENSE)
