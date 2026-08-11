<p align="center">
  <img src="https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/logo.png" alt="Awesome LinuxDo Reader" width="320">
</p>

# Awesome LinuxDo Reader

LINUX DO 全面适配、标准 Discourse 社区通用的增强阅读器：在列表页直接阅读完整主题，保留楼层关系与原站互动，并提供跨语翻译、原图灯箱、离线 Topic、WebDAV 同步和精细布局。

[安装脚本](https://update.greasyfork.org/scripts/588185/Awesome%20LinuxDo%20Reader.user.js) · [在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/) · [GitHub 项目](https://github.com/sunbigfly/awesome-linuxdo-reader) · [问题反馈](https://github.com/sunbigfly/awesome-linuxdo-reader/issues)

![在 LINUX DO 列表页右侧打开完整增强阅读工作区](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-01-reader-overview-v1.3.0.png)

## 1.3.1 重点

- **设置体验提醒**：为已有设置的用户重新投放一次恢复默认值提示；新用户不打扰，选择保留不会修改设置。
- **Boost 表情选择**：修复宿主原生表情面板已创建却被阅读器层遮挡的问题，打开、定位和关闭都与回复浮窗使用同一顶层规则。
- **离线 Topic**：后台下载全部、楼主或自选楼层，生成可搜索、可跳转并保留讨论关系的独立 HTML。
- **安全配置**：组合导出、导入与恢复默认支持失败回滚；翻译 API Key、WebDAV 用户名和密码始终排除。
- **跨设备同步**：历史、收藏、设置、阅读队列、阅读位置等记录按类别三方合并；离线 HTML 使用独立对象且默认关闭。
- **连续阅读**：浮窗、全屏、左右嵌入与移动布局，支持楼中楼、时间轴、历史导航、原图灯箱与富内容。
- **原站互动**：回复、点赞、回应、收藏、通知、搜索和用户资料继续使用当前 Discourse 账号与权限。
- **多站点兼容**：LINUX DO 保持完整覆盖；其他标准 HTTPS Discourse 自动识别，缺少的插件能力自动隐藏。

| 离线 Topic | 安全配置管理 | WebDAV 分类同步 |
| --- | --- | --- |
| ![选择范围并管理离线 HTML](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-31-topic-download-v1.3.0.png) | ![导出、导入和恢复组合设置](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-13-data-management-v1.3.0.png) | ![选择 WebDAV 同步内容](https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/assets/screenshots/guide-32-webdav-sync-v1.3.0.png) |

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或兼容的 userscript 管理器。
2. 在本页点击“安装此脚本”。普通用户只需安装主脚本，不要单独安装 Core 或 Features Library。
3. 打开或刷新 LINUX DO、内置社区或其他标准 HTTPS Discourse，点击主题标题开始使用。

> **当前版本：** Lite `1.3.1` 已发布。主 Loader `588185 / 1899428`、Core `590254 / 1899419`、Features `590255 / 1899422` 均已逐字节核验；CSS 固定到 Git `5ca40cf` 并带 SHA-256。

## 数据与权限边界

- 阅读器不接管账号体系；帖子、权限、消息、收藏和互动结果以原站为准。
- WebDAV 默认关闭，只有用户主动配置并选择类别后才访问远端。
- 离线 HTML 可能包含帖子正文和公开用户名；只应保存或同步到你控制的位置。
- 正文翻译只在用户主动开启后发送待翻译文本；具体范围见[隐私、权限与边界](https://sunbigfly.github.io/awesome-linuxdo-reader/manage/privacy-and-permissions)。

完整功能、设置、兼容性与故障排查请查看[在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/)。

许可证：[MIT License](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/LICENSE)
