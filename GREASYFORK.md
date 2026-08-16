<p align="center">
  <img src="https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/logo.png" alt="Awesome LinuxDo Reader" width="320">
</p>

# Awesome LinuxDo Reader

LINUX DO 全面适配、标准 Discourse 社区通用的增强阅读器：在列表页直接阅读完整主题，保留楼层关系与原站互动，并提供跨语翻译、原图灯箱、离线 Topic、WebDAV 同步和精细布局。

[安装脚本](https://update.greasyfork.org/scripts/588185/Awesome%20LinuxDo%20Reader.user.js) · [在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/) · [GitHub 项目](https://github.com/sunbigfly/awesome-linuxdo-reader) · [问题反馈](https://github.com/sunbigfly/awesome-linuxdo-reader/issues)

![在 LINUX DO 列表页右侧打开完整增强阅读工作区](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-01-reader-overview-v1.3.0.png)

## 1.5.0 重点

- **共享工具工作区**：通知与私信、历史、收藏与回应、Topic 下载、用户观察、岁月史书和不想看统一进入可冻结的多标签浮窗。
- **连续阅读与上下文**：浮窗、全屏、左右嵌入与移动布局，支持楼中楼、无限讨论树、时间轴、真实已读进度和历史导航。
- **内容与翻译**：原图灯箱、图片评论、批量下载、音视频、HLS、KaTeX，以及公共接口或自定义 OpenAI 兼容模型的跨语翻译。
- **离线 Topic**：后台下载全部、楼主或自选楼层，生成可搜索、可跳转并保留讨论关系的独立 HTML。
- **安全同步**：WebDAV 12 类记录按开关三方合并；翻译配置、缓存与离线 Topic 只有用户主动选择后才同步。
- **安全配置**：设置 v9 导出、导入与恢复默认支持失败回滚；翻译 API Key、WebDAV 用户名和密码始终排除。
- **快捷方式与缓存**：21 个快捷动作共用保留键门禁；六类缓存危险清理逐项列出类别并二次确认。
- **多站点兼容**：LINUX DO 保持完整覆盖；其他标准 HTTPS Discourse 自动识别，缺少的插件能力自动隐藏。

| 离线 Topic | 安全配置管理 | WebDAV 分类同步 |
| --- | --- | --- |
| ![选择范围并管理离线 HTML](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-31-topic-download-v1.3.0.png) | ![导出、导入和恢复组合设置](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-13-data-management-v1.3.0.png) | ![选择 WebDAV 同步内容](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-32-webdav-sync-v1.3.0.png) |

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或兼容的 userscript 管理器。
2. 在本页点击“安装此脚本”。普通用户只需安装主脚本，不要单独安装 Core、Platform 或 Features Library。
3. 打开或刷新 LINUX DO、内置社区或其他标准 HTTPS Discourse，点击主题标题开始使用。

> **当前版本：** Lite `1.5.0` 已发布。主 Loader `588185 / 1904252`、Core `590254 / 1904245`、Platform `591595 / 1904248`、Features `590255 / 1904246` 均已逐字节核验；CSS 固定到 Git `2a1f6695162217d4a86cf0e3958d8a361594f90b` 并带 SHA-256。

| 发布单元 | 字节与 SHA-256 |
| --- | --- |
| Loader | 原始 4,052 字节，`60a80af4e514c5131b572a1e8afb44dcf80cce7a82fe967ceb2293d96ef383e3`；移除平台元数据后 4,031 字节，`f396fbf42eca4cd0f761557cb330577034225e3967bee33f6877467f40821d5f` |
| Core | 1,552,321 字节，`a645aa16ac2592f591e2fcb0aceb9057b9e43adb9f8f21bb00e5a401eb8d804a` |
| Platform | 1,236,060 字节，`b8755569a5591fc106e2faac433e136bbbbfd3d548dc4b9369a953747f60a178` |
| Features | 1,953,979 字节，`9316bcefe26cb24f78e6fb87dadc523e71f37c4642324c4ba9475d10a6993053` |

## 数据与权限边界

- 阅读器不接管账号体系；帖子、权限、消息、收藏和互动结果以原站为准。
- WebDAV 默认关闭，只有用户主动配置并选择类别后才访问远端。
- 离线 HTML 可能包含帖子正文和公开用户名；只应保存或同步到你控制的位置。
- 正文翻译只在用户主动开启后发送待翻译文本；具体范围见[隐私、权限与边界](https://sunbigfly.github.io/awesome-linuxdo-reader/manage/privacy-and-permissions)。

完整功能、设置、兼容性与故障排查请查看[在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/)。

许可证：[MIT License](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/LICENSE)
