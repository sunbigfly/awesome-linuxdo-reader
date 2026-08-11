---
layout: home
title: Awesome LinuxDo Reader 用户手册
description: LINUX DO 全面适配、兼容中英文及其他语言 Discourse 站点并支持正文翻译的 Awesome LinuxDo Reader 用户手册。
feature_ids: ["CORE-001", "CORE-002", "CORE-004", "CORE-007", "READ-001", "ACTION-001", "DATA-001", "DATA-006", "DATA-007"]
source_anchors: ["lite/userscript.meta.txt","lite/src/queue/reader-open-queue-session.ts","lite/src/shell/reader-workspace.ts","lite/src/app/reader-application.ts","lite/src/dom/reply-tree.ts","lite/src/app/reader-browser-runtime.ts","lite/src/state/reader-settings-config-manager.ts","lite/src/sync/reader-webdav-coordinator.ts","lite/src/queue/reader-topic-download-manager.ts"]
since: 0.1.2
version: 1.3.0
status: current
last_verified: 2026-08-11
screenshots: ["/screenshots/guide-01-reader-overview-v1.3.0.png"]

hero:
  name: Awesome LinuxDo Reader
  text: 正式用户手册
  tagline: LINUX DO 全面适配，中文、英文及其他语言的标准 Discourse 站点通用。
  image:
    src: /logo.png
    alt: Awesome LinuxDo Reader 标志
  actions:
    - theme: brand
      text: 开始使用
      link: /getting-started/installation
    - theme: alt
      text: 浏览全部功能
      link: /reference/feature-catalog
    - theme: alt
      text: 排查问题
      link: /manage/troubleshooting

features:
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-book-open" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v16"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/></svg>
    title: 连续阅读
    details: 浮窗、全屏、左右嵌入与移动布局，长帖按需加载并保持真实阅读位置。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC; Compass derived from Feather - MIT --><svg class="lucide lucide-compass" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/></svg>
    title: 上下文导航
    details: 楼中楼、父回复预览、时间轴、只看楼主、历史前后切换与多主题队列。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-messages-square" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>
    title: 原生社区互动
    details: 回复、点赞、收藏、通知等操作沿用原站；回应、Boost、投票等插件能力按站点自动显示或隐藏。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-images" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/></svg>
    title: 富内容呈现
    details: 原图灯箱、图片评论、批量下载、非中文正文翻译、音视频、HLS、公式、投票和代码预览。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-sliders-horizontal" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>
    title: 精细个性化
    details: 图片、字体、五区布局、浮窗、明暗主题、结构颜色与跳转动效。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-cloud-upload" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 13v8"/><path d="m16 17-4-4-4 4"/><path d="M5.6 16.7A5 5 0 0 1 6 7a7 7 0 0 1 13.7 1.7A4.5 4.5 0 0 1 18.5 17H18"/></svg>
    title: WebDAV 跨设备同步
    details: 历史、收藏、设置、阅读队列、阅读位置与离线 Topic 等记录可独立选择，并以三方合并避免整份覆盖。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-download" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
    title: 离线 Topic 阅读
    details: 后台补齐全部、楼主或自选楼层，生成可搜索、可跳转并可选同步到 WebDAV 的独立 HTML。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-shield-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>
    title: 有界资源治理
    details: DOM 窗口、分层缓存、共享请求调度、429 退避、资源和请求监控。
---

## 手册覆盖范围

这套手册对应 userscript `1.3.0`，以 `lite/src/` 与 `lite/styles/` 为事实源。LINUX DO 是完整功能基线，消息、历史、收藏、互动、长帖、楼层关系与性能治理均保持全面适配；脚本也通过运行态识别、站点适配层和插件能力检测兼容中文、英文及其他语言的标准 Discourse 站点。WebDAV 同步由用户主动配置并按类别启用；普通缓存不上传，只有单独开启“离线 Topic 下载”后，完整 HTML 才会作为独立明文对象同步。

脚本内置 20 个其他知名 Discourse 社区，并会在任意 HTTPS 域名上以本地运行态和 DOM 证据自动识别标准 Discourse；深度定制站点可验证添加为兼容兜底。站点适配本身不限制内容语言；除内置中文站点 LINUX DO 外，其他 Discourse 社区另提供原文、双语和简体中文译文三种阅读状态。功能目录记录了每项能力的源码锚点、版本、验证日期、截图和对应文档。

::: tip 推荐路径
第一次使用按“安装与更新 → 五分钟上手 → 界面总览”阅读。遇到加载、图片或限流问题，直接进入“故障排查”。
:::

![LINUX DO 列表页右侧嵌入阅读器的完整工作区](/screenshots/guide-01-reader-overview-v1.3.0.png)

<p class="image-caption">阅读器可以保留宿主主题列表，同时在独立工作区中阅读完整主题。</p>

## 先了解五个边界

1. 阅读器不接管账号体系，登录、权限、内容和互动结果都以当前 Discourse 原站为准。
2. 缓存清理只影响当前浏览器里的阅读器数据，不会删除原站帖子、消息、收藏或回应。
3. LINUX DO 保持完整覆盖；其他站点缺少 Boost、Reactions、Post Voting 等插件时，对应入口会自动隐藏。
4. 正文翻译只在用户主动开启后发送待翻译文本；未配置 Key 时使用第三方 Google / Microsoft 接口，配置后使用用户选择的 OpenAI 兼容服务。
5. 请求监控能说明当前页面观察到的活动，但浏览器不会提供单个 userscript 的绝对 CPU 或独占内存。
