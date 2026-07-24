---
layout: home
title: Awesome LinuxDo Reader 用户手册
description: 从安装到进阶调优，完整掌握 Awesome LinuxDo Reader。
feature_ids: ["CORE-001", "CORE-002", "CORE-004", "READ-001", "ACTION-001", "DATA-001"]
source_anchors: ["@downloadURL", "ldp-native-reader-trigger", "LIST_READER_MODES", "stableStreamMountRange", "ldp-replybtn", "readerConfigExportPayload"]
since: 0.1.2
version: 0.1.4
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-01-reader-overview.png"]

hero:
  name: Awesome LinuxDo Reader
  text: 正式用户手册
  tagline: 在 LINUX DO 列表页内完成长帖阅读、上下文追踪与社区互动。
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
    details: 回复、点赞、回应、Boost、收藏、通知、分享、编辑、举报和权限操作。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-images" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/></svg>
    title: 富内容呈现
    details: 原图灯箱、图片评论、批量下载、音视频、HLS、公式、投票和代码预览。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-sliders-horizontal" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>
    title: 精细个性化
    details: 图片、字体、五区布局、浮窗、明暗主题、结构颜色与跳转动效。
  - icon: >-
      <!-- @license Lucide Icons v1.26.0 - ISC --><svg class="lucide lucide-shield-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>
    title: 有界资源治理
    details: DOM 窗口、分层缓存、共享请求调度、429 退避、资源和请求监控。
---

## 手册覆盖范围

这套手册对应 userscript `0.1.4`，以当前源码和真实 LINUX DO 运行界面为事实源。功能目录记录了每项能力的源码锚点、版本、验证日期、截图和对应文档；自动检查会阻止“功能存在但没有文档”或“文档还指向旧版本”的变更。

::: tip 推荐路径
第一次使用按“安装与更新 → 五分钟上手 → 界面总览”阅读。遇到加载、图片或限流问题，直接进入“故障排查”。
:::

![LINUX DO 列表页右侧嵌入阅读器的完整工作区](/screenshots/guide-01-reader-overview.png)

<p class="image-caption">阅读器可以保留宿主主题列表，同时在独立工作区中阅读完整主题。</p>

## 先了解三个边界

1. 阅读器不接管账号体系，登录、权限、内容和互动结果都以 LINUX DO 原站为准。
2. 缓存清理只影响当前浏览器里的阅读器数据，不会删除原站帖子、消息、收藏或回应。
3. 请求监控能说明当前页面观察到的活动，但浏览器不会提供单个 userscript 的绝对 CPU 或独占内存。
