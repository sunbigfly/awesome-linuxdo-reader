<p align="center">
  <img src="assets/logo.png" alt="Awesome LinuxDo Reader" width="300">
</p>

<h1 align="center">Awesome LinuxDo Reader</h1>

<p align="center">在主题列表里完成长帖阅读、上下文追踪与原站互动。</p>

<p align="center">
  <a href="https://greasyfork.org/zh-CN/scripts/588185-awesome-linuxdo-reader">安装脚本</a> ·
  <a href="https://sunbigfly.github.io/awesome-linuxdo-reader/">用户手册</a> ·
  <a href="lite/src/userscript/main-lite-entry.ts">Lite 源码</a> ·
  <a href="CONTRIBUTING.md">参与开发</a>
</p>

<p align="center">
  <a href="assets/screenshots/guide-01-reader-overview-v1.3.0.png">
    <img src="assets/screenshots/guide-01-reader-overview-v1.3.0.png" alt="LINUX DO 列表页右侧的增强阅读工作区" width="960">
  </a>
</p>

Awesome LinuxDo Reader 是面向 Discourse 长内容的 userscript。它对 LINUX DO 保持完整适配，也能自动识别标准 HTTPS Discourse 社区；站点缺少 Boost、Reactions、Topic Voting 等插件时，相应入口会自然隐藏。

## 重要特性

- **连续阅读**：浮窗、全屏、左右嵌入与移动布局；长帖虚拟化加载，时间轴、历史前后切换、多主题队列和真实已读进度保持连续。
- **完整上下文**：楼中楼、无限树状完整讨论、父回复与引用回跳、只看楼主、已解决答案、系统事件和目标楼层高亮。
- **原站互动**：回复、划词引用、点赞、表情回应、Boost、收藏、通知级别、分享、举报、编辑、删除与站点插件操作都沿用原站权限和状态。
- **共享工具工作区**：通知与私信、浏览历史、收藏与回应、Topic 下载、用户观察、岁月史书和不想看共用可冻结的多标签浮窗。
- **用户观察与内容留存**：渐进整理用户公开活动；“自己”额外汇总私有消息与收藏投影；服务器已 404、但本机仍有正文的内容可进入岁月史书继续阅读。
- **富内容与跨语阅读**：原图灯箱、图片评论、批量下载、音视频、HLS、KaTeX、投票、代码工具，以及原文、双语、全译文和自定义 OpenAI 兼容翻译服务。
- **离线 Topic**：后台补齐全部、楼主或自选楼层，生成可搜索、可跳转并保留讨论关系的独立 HTML。
- **精细个性化**：字体、图片比例、五区布局、颜色、关系线、动效和快捷方式；暗色可按当地日落或固定时间自动启用，并在日出恢复原主题。
- **安全同步与诊断**：WebDAV 按类别合并历史、收藏、队列、设置和离线内容；配置导出排除秘密字段；请求、429、Cloudflare、DOM 与性能状态可脱敏查看和导出。

完整的 110 项用户可见能力与对应手册见[功能覆盖目录](https://sunbigfly.github.io/awesome-linuxdo-reader/reference/feature-catalog)。

## 版本与安装

当前项目版本为 `1.5.0`。

### 1.5.0 重点

把阅读工具收敛为共享多标签工作区，补齐用户观察、岁月史书、不想看自动过滤、当地日落自动暗色、后台集合续传和四文件构建一致性门禁，并全面更新用户手册。1.3.0 之后的数据链路也统一完成收口：WebDAV 12 类同步、设置 v9 导入导出与失败回滚、21 个快捷动作、六类缓存清理屏障及危险清理二次确认共用同一组安全边界。

`1.5.0` 已同步到 GitHub、Greasy Fork 四文件链和用户手册。普通用户仍只需安装主脚本；Loader 会固定加载同一发布快照的 Core、Platform、Features，并从不可变 Git 提交读取 CSS。

| 发布单元 | Greasy Fork 固定版本 | 字节与 SHA-256 |
| --- | --- | --- |
| Loader | `588185 / 1904252` | 原始 4,052 字节，`60a80af4e514c5131b572a1e8afb44dcf80cce7a82fe967ceb2293d96ef383e3`；移除平台元数据后 4,031 字节，`f396fbf42eca4cd0f761557cb330577034225e3967bee33f6877467f40821d5f` |
| Core | `590254 / 1904245` | 1,552,321 字节，`a645aa16ac2592f591e2fcb0aceb9057b9e43adb9f8f21bb00e5a401eb8d804a` |
| Platform | `591595 / 1904248` | 1,236,060 字节，`b8755569a5591fc106e2faac433e136bbbbfd3d548dc4b9369a953747f60a178` |
| Features | `590255 / 1904246` | 1,953,979 字节，`9316bcefe26cb24f78e6fb87dadc523e71f37c4642324c4ba9475d10a6993053` |

CSS 固定到 Git `2a1f6695162217d4a86cf0e3958d8a361594f90b`：610,039 字节，SHA-256 `db6d4a47f0fb07f002907a6c9788f730f233b902d548238da0023a46182a026a`。

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或兼容 userscript 管理器。
2. 打开 [Greasy Fork 脚本页](https://greasyfork.org/zh-CN/scripts/588185-awesome-linuxdo-reader) 并安装。
3. 刷新 LINUX DO 或其他标准 Discourse 社区，点击主题标题开始阅读。

站点范围、权限差异和翻译边界见[兼容性说明](https://sunbigfly.github.io/awesome-linuxdo-reader/reference/compatibility)。

## 工程结构

Lite 的事实源只有：

- `lite/src/`：TypeScript 业务源码；
- `lite/styles/`：阅读器样式；
- `lite/userscript.meta.txt`：userscript 元数据。

Greasy Fork 使用薄 Loader + Core + Platform + Features 四个可执行文件；CSS 由固定 Git 提交和 SHA-256 的 `@resource` 加载，不是第五个执行文件。生成物可读、不混淆，每个执行文件都有 2 MiB 发布闸门。

本地开发同时生成两种审查入口：

```bash
npm run main-lite:local-debug
```

- `work/main-lite.local.js`：单文件快速调试版；
- `work/main-lite.greasyfork.local.user.js`：本地四文件 Loader。

该命令会让事实源与实际分包 runtime 分别跑完同一套契约，并核对元数据、CSS、全部源码模块哈希、manifest 和兼容副本。两种本地版本不可同时启用。

开发、测试与提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 用户手册

[在线用户手册](https://sunbigfly.github.io/awesome-linuxdo-reader/)覆盖安装、阅读导航、社区互动、消息与收藏、用户观察、媒体、翻译、全部设置、WebDAV、数据边界、诊断和故障排查。机器可读目录位于 [`docs/public/feature-catalog.json`](docs/public/feature-catalog.json)。

GitHub README 与 Greasy Fork 公开介绍共用的版本、能力和数据边界文案集中维护在 [`docs/INTRODUCTION.md`](docs/INTRODUCTION.md)；发布时两处从同一最终坐标更新，避免源码说明与脚本页长期分叉。

## 许可

[MIT License](LICENSE)
