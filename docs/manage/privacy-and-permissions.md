---
title: 隐私、权限与边界
description: 理解 userscript 权限、WebDAV 凭据与同步边界、LDC 只读数据、外部依赖、本地存储和请求脱敏。
feature_ids: ["MEDIA-014", "USER-006", "DATA-004", "DATA-005", "DATA-006", "DATA-007", "MONITOR-005", "TROUBLE-005"]
source_anchors: ["lite/src/translation/reader-translation-controller.ts","lite/src/translation/translation-request-adapter.ts","lite/src/cache/response-repository.ts","lite/src/state/reader-settings-config-manager.ts","lite/src/userscript/browser-userscript-environment.ts","lite/src/network/request-observer.ts","lite/src/sync/reader-webdav-client.ts","lite/src/sync/reader-webdav-config-repository.ts","lite/src/sync/reader-webdav-offline-topic-port.ts","lite/src/archive/reader-topic-offline-artifact-repository.ts","lite/userscript.meta.txt"]
since: 0.1.2
version: 1.5.2
status: current
last_verified: 2026-08-16
screenshots: ["/screenshots/guide-14-about-v1.5.0.png"]
---

# 隐私、权限与边界

![关于面板中的版本、第三方组件、许可证和项目边界信息](/screenshots/guide-14-about-v1.5.0.png)

<p class="image-caption">关于面板集中展示当前版本、第三方参考项目和许可证；账号数据与互动结果仍以 LINUX DO 原站为准。</p>

## userscript 元数据

当前 `1.5.2`：

| 字段 | 值 | 用途 |
| --- | --- | --- |
| `@match` | 21 个内置社区及 `https://*/*` | 在所有 HTTPS 页面进行无网络的轻量 Discourse 识别；成功才初始化阅读器，失败静默退出 |
| `@grant` | `GM_getValue`、`GM_setValue` | 保存设置、自定义站点和同账号最近一次 LDC 成功缓存 |
| `@grant` | `GM_xmlhttpRequest` | 检测自定义站点、读取 LDC 只读账户摘要、访问用户配置的 HTTPS WebDAV、获取允许的跨域公开资源，以及执行用户主动开启的正文翻译 |
| `@grant` | `GM_getResourceText` | 读取发布版样式资源 |
| `@grant` | `unsafeWindow` | 与当前 Discourse 页面运行时协作 |
| `@connect` | `connect.linux.do`、`credit.linux.do`、翻译接口及 `*` | Connect、LDC 只读账户摘要、Google / Microsoft 或用户配置的 OpenAI 兼容翻译、用户输入域名的 Discourse 检测，以及用户主动配置的 WebDAV 服务 |
| `@run-at` | `document-start` | 在 SPA 和页面初始化前建立必要边界 |

安装时脚本管理器会展示权限。若未来新增 GM API 或跨域目标，项目必须同步更新源码、功能目录和本页。

## 外部依赖

脚本从 jsDelivr 加载固定版本：

- KaTeX `0.16.22`；
- pinyin-pro `3.18.2`；
- hls.js `1.6.16`。

依赖不可用时，相应公式、拼音检索或 HLS 能力可能降级；普通文本阅读不应依赖这些增强全部成功。

## 本地数据

当前浏览器会保存设置、历史、主题快照、用户卡、消息分页、通用响应、最多 240 条正文译文以及部分头像/图片。存储按账号作用域和数据类型隔离、有最大容量和保留期。

设置导出可以包含其他适用站点、翻译和 WebDAV 的非敏感规则，但不包含历史、正文、API 响应、图片、Cookie、翻译 API Key、WebDAV 用户名、密码或原站账号凭据。

## WebDAV 数据与凭据

WebDAV 默认关闭，只有用户填写 HTTPS 地址、账号、应用密码并选择类别后才会访问远端。WebDAV 账号和应用密码只保存在 userscript 专属存储，不进入远端 JSON、设置导出、同步的“设置配置”类别或请求 URL。

远端主同步文件只保存所选普通类别的结构化记录、更新时间、写入设备标识和删除标记。Cookie、Authorization、WebDAV 密码、页面缓存与短期限流状态永不上传。离线 Topic、AI 服务集合和已翻译 Section 缓存默认关闭：离线 Topic 只在单独启用时上传轻量清单和每个 Topic 的完整明文 HTML，图片与附件仍保留原 URL；AI 服务只写入 URL、缓存模型目录、翻译业务选择、参数及使用 WebDAV 应用密码加密的 API Key；译文缓存不包含原文。收藏同步只交换阅读器的链接和定位信息，不直接修改原站收藏状态。

远端文件受 WebDAV 服务商账号安全和存储政策约束。应使用独立的第三方应用密码；停用同步时可以关闭定时同步并清空本机凭据，但删除远端文件会影响其他设备，需在服务商侧单独确认。

## 原站数据

阅读器不创建独立账号体系。回复、点赞、回应、收藏、通知级别、用户关系、举报和管理操作会调用原站能力。成功提示后若状态重要，应在网络恢复时再次确认。

LDC 面板通过显式声明的 `@connect credit.linux.do` 只读取当前登录会话返回的账户摘要，不包含支付密钥内容，也不会发起支付、转账或设置修改。脚本会核对 LDC 用户名与当前 LINUX DO 用户名；不一致时拒绝采用联网结果。最近一次同账号成功结果可在脚本存储中保留 30 分钟，设置导出不包含这份缓存。

## 监控数据

资源和请求监控只在当前标签页内存中保留有限时间。请求路径会去除查询参数，不记录 Cookie、授权头、正文或响应内容。

浏览器开发者工具、HAR、扩展后台日志可能包含更多敏感数据，不属于阅读器自身的脱敏保证。

## 翻译与自定义站点请求

- 只有用户主动切换到双语或全译文后，普通正文文本才会发送给 Google / Microsoft 公共接口或用户选择的 OpenAI 兼容服务；Cookie、原站授权头和表单内容不会附带。
- 译文进入最多 240 条的中央 Section 缓存，不进入设置导出；只有用户单独启用 WebDAV 的“已翻译 Section 缓存”类别后才跨设备同步，且不携带原文。
- AI 服务 API Key 保存在脚本专属配置；启用 WebDAV 的“AI 服务集合”时，Key 使用当前 WebDAV 应用密码经 PBKDF2 派生密钥后加密，其他配置明文同步。更换应用密码后，旧设备需使用加密时的密码才能解密。
- 主动获取供应商模型或打开“公共模型能力查询”且本地缓存缺失/过期时，脚本会匿名读取固定的 `models.dev/models.json` 与 OpenRouter 公共模型目录；请求不携带供应商 API Key，也不发送当前模型 ID。公共目录缓存在本机脚本存储中，不写入 WebDAV。
- 自动识别未知站点只检查当前页面的 Discourse 原生模块和 DOM 标志，不发送网络请求；只有用户主动添加兼容兜底站点时，才向输入的 HTTPS 域名匿名请求公开的 `/site/basic-info.json`，且不附带当前论坛 Cookie。
- 第三方翻译服务和目标论坛仍受各自隐私政策、可用性与地区网络限制约束。

## 截图与问题报告

发布前遮盖：

- 用户名、显示名称、头像；
- 私信、通知和帖子正文；
- 主题 ID、唯一楼层组合和账号统计；
- Cookie、Authorization、API key、响应正文；
- 能推断账号身份的自定义设置或历史。

安全问题按 [SECURITY.md](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/SECURITY.md) 报告：Security 页有 **Report a vulnerability** 时使用私密入口；没有入口时，公开 Issue 只能请求私密联络，不能附漏洞细节或敏感材料。普通问题使用 GitHub Issues。
