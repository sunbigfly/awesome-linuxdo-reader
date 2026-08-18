---
title: 离线 Topic 下载
description: 在后台补齐 Topic 正文，保存可独立打开的离线 HTML，并管理本地与 WebDAV 副本。
feature_ids: ["DATA-004", "DATA-006", "DATA-007"]
source_anchors: ["lite/src/queue/reader-topic-download-manager.ts","lite/src/archive/reader-topic-offline-document.ts","lite/src/archive/reader-topic-offline-artifact-repository.ts","lite/src/topic/reader-topic-local-archive-feature.ts","lite/src/sync/reader-webdav-offline-topic-port.ts"]
since: 1.3.0
version: 1.5.7
status: current
last_verified: 2026-08-18
screenshots: ["/screenshots/guide-31-topic-download-v1.5.0.png", "/screenshots/guide-32-webdav-sync-v1.5.0.png"]
---

# 离线 Topic 下载

阅读器可以在后台补齐当前 Topic，把正文、楼层关系和阅读工具封装成一个可独立打开的 HTML 文件。入口位于主题操作列的“下载”与“下载历史”。

![Topic 下载窗口中的范围选择、后台任务和历史管理](/screenshots/guide-31-topic-download-v1.5.0.png)

<p class="image-caption">先选择全部、楼主或自定义楼层，再开始后台下载；下方历史区用于搜索与批量管理。</p>

## 下载一个 Topic

1. 打开目标 Topic。
2. 在操作列打开“Topic 下载”。
3. 选择范围：
   - **全部楼层**：保存当前账号可读取的完整正文；
   - **只看楼主**：以楼主楼层为主流，同时保留需要的讨论上下文；
   - **自定义楼层**：使用 `1,3,8-12` 这类表达式选择楼层。
4. 点击“开始后台下载”。窗口可关闭，任务仍会继续。
5. 任务完成后，从下载历史选择“离线查看”或把 HTML 保存到本机。

下载过程会遵守阅读器的请求协调、站点挑战等待与限流退避。正文没有补齐时不会把不完整结果冒充完整存档；若原 Topic 已不可用但浏览器仍保留本地正文，则会导出可用内容并在文件中标注缺失范围。

本地下载目录和完整 HTML 按当前站点账号隔离；同一浏览器切换账号后，不会看到或覆盖另一个账号的同 id Topic。升级前已有的无账号目录只由首个已登录账号安全认领一次，旧正文仍保留以便回退。

## 离线 HTML 能做什么

- 按楼层 ID、用户名或正文搜索；
- 只看楼主、楼层跳转和回复分支浏览；
- 保留下载时的主题、结构颜色与正文显示设置；
- 按下载开始时的原文、双语或全译文设置生成，并保留当时的译文样式；双语或全译文会先复用当前已完成译文与持久化 Section 翻译缓存，只把缓存缺失的正文交给现有翻译任务和限流链，补齐本次下载范围内的全部译文后再生成离线 HTML；
- 把标题、正文和附属字段中可解析的 `:shortcode:` 表情固化为实际图片；
- 展示下载时已经取得的引用、回应、投票、Callout 与公式等内容；
- 对已删除、隐藏或不可访问的本地存档明确标记来源状态。

HTML 自带阅读界面，不需要重新安装脚本。图片、视频和附件只保留原始 URL，不会打包二进制资源；完全断网时，这些外部资源可能无法显示。

## 下载历史与删除

下载历史支持标题、Topic ID、文件名搜索和批量管理。删除时可以只移除历史记录并保留 Reader 缓存 HTML，也可以同时删除记录与缓存；已经保存到操作系统下载目录的文件不受影响。

离线 Artifact 属于阅读器本地数据，不等同于普通 Topic 缓存。清理主题缓存不会自动删除已完成的离线 HTML，删除下载记录时应按确认弹层选择范围。

## 可选 WebDAV 同步

“设置 → WebDAV 同步 → 离线 Topic 下载”默认关闭。开启后，下载历史写入轻量清单，每个 Topic 的完整 HTML 作为独立明文对象保存，不占用 2 MiB 主同步文件。同步仍使用 ETag 与三方合并；对象缺失或 SHA-256 不一致时会报错并保留本机副本。

![WebDAV 同步内容中的离线 Topic 独立开关](/screenshots/guide-32-webdav-sync-v1.5.0.png)

<p class="image-caption">离线 Topic 与普通记录、翻译配置和译文缓存分别控制；不开启就不会上传 HTML。</p>

离线 HTML 可能包含帖子正文和公开用户名。只应同步到你控制的 WebDAV，分享文件前也应按正文内容自行判断隐私范围。
