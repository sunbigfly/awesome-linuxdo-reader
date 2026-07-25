# Awesome LinuxDo Reader

为 LINUX DO 深度定制并保持完整功能覆盖，同时通过站点识别、适配层和能力检测兼容中文、英文及其他语言的标准 Discourse 社区。无需离开主题列表，即可完成长帖阅读、正文翻译、回复和原站互动。

## 核心特性

- **LINUX DO 全面适配**：消息、历史、收藏、回应、Boost、长帖、楼层关系和性能治理保持完整覆盖。
- **标准 Discourse 站点通用**：中文、英文及其他语言站点均可使用；内置 21 个社区，其他 HTTPS Discourse 论坛可验证后添加。
- **跨语正文翻译**：非中文内置社区支持原文、双语和简体中文译文切换，Google 与 Microsoft 翻译服务互为回退。
- **连续阅读**：在列表页内打开完整主题，支持浮窗、全屏、左右嵌入和移动端布局。
- **上下文导航**：支持楼中楼、父回复预览、时间轴、只看楼主、历史前后切换和多主题阅读队列。
- **原站互动**：回复、点赞、收藏和通知沿用原站；Reactions、Boost、Post Voting 等入口按站点插件能力自动显示或隐藏。
- **富内容与性能**：提供原图灯箱、图片评论、媒体播放、公式渲染、DOM 窗口化、分层缓存和 429 退避。

## 已内置的部分社区

LINUX DO、OpenAI Developer Community、Discourse Meta、Brave Community、Roblox Developer Forum、Home Assistant Community、Arduino Forum、Unity Discussions、Cloudflare Community、Epic Developer Community、Obsidian Forum、Cursor Community、Python Discussions、Swift Forums、Julia Discourse 和 Rust Users Forum 等。

完整站点列表、能力差异和自定义站点说明见[兼容性文档](https://sunbigfly.github.io/awesome-linuxdo-reader/reference/compatibility)。

## 翻译说明

站点适配不限内容语言。翻译按钮位于阅读器标题栏，只在已标记为非中文的内置社区显示，当前译文目标为简体中文。翻译会跳过代码、公式、投票、Onebox 和表单；只有用户主动切换到双语或全译文后，普通正文才会发送给第三方翻译服务。涉及命令、金额、权限和安全操作时，请切回原文核对。

## 界面预览

![增强阅读工作区](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-01-reader-overview.png)

![消息中心](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-15-notifications-replies.png)

![收藏与回应](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-17-bookmarks-reactions.png)

## 使用

1. 安装 Tampermonkey、Violentmonkey 或兼容的 userscript 管理器。
2. 在本页点击“安装此脚本”。
3. 打开 LINUX DO 或其他已内置的 Discourse 社区，点击主题标题开始使用。
4. 其他 HTTPS Discourse 论坛可在“设置 → 其他功能 → 自定义站点”中验证并添加。

[正式用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/) · [GitHub 项目](https://github.com/sunbigfly/awesome-linuxdo-reader) · [问题反馈](https://github.com/sunbigfly/awesome-linuxdo-reader/issues)

许可证：MIT License
