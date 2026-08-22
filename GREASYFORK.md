<p align="center">
  <img src="https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/logo.png" alt="Awesome LinuxDo Reader" width="320">
</p>

# Awesome LinuxDo Reader

**把 Discourse 从帖子列表，变成完整的阅读工作区。**

在一个连续界面中完成长帖阅读、上下文追踪、跨语翻译、原站互动与资料整理。为 LINUX DO 深度定制，也适用于标准 HTTPS Discourse 社区。

[安装脚本](https://update.greasyfork.org/scripts/588185/Awesome%20LinuxDo%20Reader.user.js) · [在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/) · [111 项功能目录](https://sunbigfly.github.io/awesome-linuxdo-reader/reference/feature-catalog) · [GitHub 项目](https://github.com/sunbigfly/awesome-linuxdo-reader) · [问题反馈](https://github.com/sunbigfly/awesome-linuxdo-reader/issues)

![LINUX DO 主题列表与增强阅读工作区](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-01-reader-overview-v1.5.0.png)

## 为长内容重新设计 Discourse 阅读体验

Awesome LinuxDo Reader 不是独立论坛，也不替代原站。它在保留当前账号、权限、内容来源和列表状态的前提下，为主题列表增加完整阅读工作区，让阅读、定位、回复和整理资料不再依赖频繁跳页。

LINUX DO 是完整功能基线。其他标准 Discourse 社区会根据站点运行态和插件能力自动适配；站点没有 Boost、Reactions 或 Topic Voting 时，相应入口自然隐藏。

## 核心能力

- **连续阅读工作区**：在浮窗、全屏、左右嵌入或移动布局中直接阅读完整主题；长帖按需渲染，多主题队列、历史切换和真实已读进度保持连续。
- **完整讨论上下文**：还原楼中楼、父回复、引用来源和完整讨论树，支持只看楼主、已解决答案、时间轴、目标楼层高亮与跨 Topic 回跳。
- **原站级互动**：回复、划词引用、点赞、表情回应、Boost、收藏、通知、分享、编辑和举报继续使用原站 API、登录态与权限判断。
- **共享工具工作区**：通知与私信、历史、收藏与回应、Topic 下载、用户观察、岁月史书和不想看集中到可冻结的多标签浮窗。
- **富内容与跨语阅读**：覆盖原图灯箱、图片评论、批量下载、音视频、HLS、KaTeX、投票与代码工具，支持原文、双语、全译文和自定义 OpenAI 兼容翻译服务。
- **可控的数据与性能**：提供离线 Topic、WebDAV 12 类同步、设置 v9 导入导出、六类缓存治理、21 个快捷动作、请求诊断、429 退避和长帖虚拟化。

| 理解讨论关系 | 保留重要内容 | 同步由你决定 |
| --- | --- | --- |
| ![父回复、楼中楼与正式楼层](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-18-thread-context-v1.5.0.png) | ![离线 Topic 下载与管理](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-31-topic-download-v1.5.0.png) | ![WebDAV 分类同步设置](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-32-webdav-sync-v1.5.0.png) |

## 从打开主题到完成阅读

1. **留在主题列表**：点击标题后在当前页面打开主题，不打断列表筛选和浏览位置。
2. **沿上下文阅读**：通过时间轴、楼层关系、只看楼主、历史导航和多主题队列持续推进。
3. **直接完成互动**：回复、点赞、收藏和其他社区动作提交到当前原站。
4. **按需整理内容**：把重要主题加入收藏、阅读队列、离线 Topic 或自己选择的 WebDAV 同步类别。

## 适合这些场景

- 每天在 LINUX DO 或其他 Discourse 社区跟进大量主题。
- 阅读数百楼的长帖，需要随时确认引用、父回复和讨论分支。
- 在中文与非中文社区之间切换，希望保留原文并快速获得双语内容。
- 集中处理通知、私信、收藏、用户动态和历史内容。
- 离线保存重要主题，或在多设备间延续自己选择的阅读数据。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或兼容的 userscript 管理器。
2. 在本页点击“安装此脚本”。普通用户只需安装主脚本，不需要单独安装 Core、Platform 或 Features Library。
3. 打开或刷新 LINUX DO、内置社区或其他标准 HTTPS Discourse，点击主题标题开始使用。

> 当前正式版为 Lite `1.6.1`。发布坐标：Loader `588185 / 1909752`、Core `590254 / 1909749`、Platform `591595 / 1909731`、Features `590255 / 1909750`。更新后刷新已打开的 Discourse 页面，并在“设置 → 关于”或脚本管理器中核对实际运行版本。

## 数据与权限边界

- **原站优先**：账号、权限、帖子、消息、收藏和互动结果始终以当前 Discourse 原站为准。
- **本地优先**：设置、阅读状态和缓存默认保存在当前浏览器；WebDAV 默认关闭。
- **主动同步**：只有配置 WebDAV 并选择具体类别后，阅读器才访问对应远端。
- **秘密隔离**：设置导出不会包含翻译 API Key、WebDAV 用户名或密码；导入失败会回滚已应用内容。
- **安全清理**：缓存清理、设置重置、设置导入和 WebDAV 同步是四种独立操作，不会删除原站内容。
- **透明诊断**：请求、429、Cloudflare、缓存和资源状态可以脱敏查看，不导出 Cookie 或 Authorization。
- 离线 HTML 可能包含帖子正文和公开用户名；只应保存或同步到你控制的位置。

完整的 111 项用户可见能力、设置、兼容性与故障排查请查看[在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/)。

许可证：[MIT License](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/LICENSE)
