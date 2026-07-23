---
layout: home
title: Awesome LinuxDo Reader 用户手册
description: 从安装到进阶调优，完整掌握 Awesome LinuxDo Reader。
feature_ids: ["CORE-001", "CORE-002", "CORE-004", "READ-001", "ACTION-001", "DATA-001"]
source_anchors: ["@downloadURL", "ldp-native-reader-trigger", "LIST_READER_MODES", "stableStreamMountRange", "ldp-replybtn", "readerConfigExportPayload"]
since: 0.1.2
version: 0.1.2
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
  - icon: 📖
    title: 连续阅读
    details: 浮窗、全屏、左右嵌入与移动布局，长帖按需加载并保持真实阅读位置。
  - icon: 🧭
    title: 上下文导航
    details: 楼中楼、父回复预览、时间轴、只看楼主、历史前后切换与多主题队列。
  - icon: 💬
    title: 原生社区互动
    details: 回复、点赞、回应、Boost、收藏、通知、分享、编辑、举报和权限操作。
  - icon: 🖼️
    title: 富内容呈现
    details: 原图灯箱、图片评论、批量下载、音视频、HLS、公式、投票和代码预览。
  - icon: 🎛️
    title: 精细个性化
    details: 图片、字体、五区布局、浮窗、明暗主题、结构颜色与跳转动效。
  - icon: 🛡️
    title: 有界资源治理
    details: DOM 窗口、分层缓存、共享请求调度、429 退避、资源和请求监控。
---

## 手册覆盖范围

这套手册对应 userscript `0.1.2`，以当前源码和真实 LINUX DO 运行界面为事实源。功能目录记录了每项能力的源码锚点、版本、验证日期、截图和对应文档；自动检查会阻止“功能存在但没有文档”或“文档还指向旧版本”的变更。

::: tip 推荐路径
第一次使用按“安装与更新 → 五分钟上手 → 界面总览”阅读。遇到加载、图片或限流问题，直接进入“故障排查”。
:::

![LINUX DO 列表页右侧嵌入阅读器的完整工作区](/screenshots/guide-01-reader-overview.png)

<p class="image-caption">阅读器可以保留宿主主题列表，同时在独立工作区中阅读完整主题。</p>

## 先了解三个边界

1. 阅读器不接管账号体系，登录、权限、内容和互动结果都以 LINUX DO 原站为准。
2. 缓存清理只影响当前浏览器里的阅读器数据，不会删除原站帖子、消息、收藏或回应。
3. 请求监控能说明当前页面观察到的活动，但浏览器不会提供单个 userscript 的绝对 CPU 或独占内存。
