---
title: 图片、媒体与富内容
description: 使用原图灯箱、图片评论、下载、音视频、公式、投票和代码预览。
feature_ids: ["READ-012", "MEDIA-001", "MEDIA-002", "MEDIA-003", "MEDIA-004", "MEDIA-005", "MEDIA-006", "MEDIA-007", "MEDIA-008", "MEDIA-009", "MEDIA-010", "MEDIA-011", "MEDIA-012", "MEDIA-013"]
source_anchors: ["renderSolvedAnswerCard", "IMAGE_SCALE_OPTIONS", "openLightbox", "lightboxOriginalByDefault", "loadLightboxCommentTree", "lightboxDescriptionHeight", "batch-download", "openUserAvatarViewer", "bindReaderHls", "KATEX_VERSION", "renderReaderPoll", "data-reader-code-action", "readerMediaHtml", "showReaderImageRetry"]
since: 0.1.2
version: 0.1.2
status: current
last_verified: 2026-07-23
screenshots: ["/screenshots/guide-19-image-lightbox.png"]
---

# 图片、媒体与富内容

## 帖子图片

正文图片比例可以按浮窗、全屏、移动分别保存，范围为 50%–200%。比例只影响帖子内显示尺寸，不修改远端图片。

点击图片进入灯箱。常用操作：

| 操作 | 控件或快捷键 |
| --- | --- |
| 放大 / 缩小 | `+` / `-` 或顶部按钮 |
| 适应窗口 | `0` 或重置按钮 |
| 前后翻图 | `←` / `→` 或两侧按钮 |
| 查看原图 | “查看原图”按钮 |
| 回到楼层 | “跳到楼层”按钮 |
| 关闭 | `Esc` |

![原图灯箱、图片序列、工具栏、描述和关联评论](/screenshots/guide-19-image-lightbox.png)

## 原图、描述与评论

- **原图**：默认先用预览图；可在设置中改成每次灯箱都优先取原图。
- **描述**：可以展开、收起并拖动底边调整高度，状态会保存。
- **关联评论**：评论面板按图片所在楼层查找直接关系；数据缺失时按需搜索主题。
- **评论宽度**：拖动分隔线调整，允许范围为灯箱宽度的 18%–50%。

原图或来源楼层加载失败时，灯箱会保留现有预览并给出重试/不可用状态。来源楼层 404 不一定意味着 CDN 图片已经失效。

## 下载

- 单张下载获取当前可用的最佳图片资源。
- 批量下载进入多选状态，再处理选中的图片。
- 浏览器可能根据安全设置询问保存位置或拦截连续下载。

下载只在用户明确操作后发生。大量原图会占用带宽和浏览器资源缓存。

## 头像与资料媒体

点击用户头像可以打开独立预览器，支持缩放、前后翻看和下载。头像缓存与帖子原图缓存分开管理。

## 视频、音频与 HLS

阅读器保留原生音视频控件，并用 hls.js 处理浏览器不能直接播放的 HLS 流。播放能力仍受以下因素影响：

- 媒体服务器是否允许当前来源；
- 浏览器编码器支持；
- 自动播放和音频权限；
- 源地址是否过期或需要登录。

关闭阅读器时会释放已绑定媒体和 Object URL。

## 公式、投票和代码块

- KaTeX `0.16.22` 用于数学公式。
- 投票支持选择、提交、更新、撤销和结果切换；权限与截止状态以原站为准。
- 代码块支持复制和阅读器内预览；预览副本可以编辑并下载，本地编辑不会修改原帖。

## Onebox 与特殊内容

主题链接卡片、内联 Onebox、SVG、Markdown 提示块、已解决答案和部分系统事件沿用阅读器统一内容样式。第三方 iframe 或嵌入内容仍受浏览器 CSP、跨域和原站策略约束。
