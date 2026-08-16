---
title: 图片、媒体与富内容
description: 使用非中文正文翻译、原图灯箱、图片评论、下载、音视频、公式、投票和代码预览。
feature_ids: ["READ-012", "MEDIA-001", "MEDIA-002", "MEDIA-003", "MEDIA-004", "MEDIA-005", "MEDIA-006", "MEDIA-007", "MEDIA-008", "MEDIA-009", "MEDIA-010", "MEDIA-011", "MEDIA-012", "MEDIA-013", "MEDIA-014"]
source_anchors: ["lite/src/topic/reader-topic-special-content-feature.ts","lite/src/media/reader-image-scale.ts","lite/src/app/reader-browser-runtime.ts","lite/src/network/public-resource-request-adapter.ts","lite/src/media/reader-lightbox-controller.ts","lite/src/media/reader-image-download-service.ts","lite/src/user/discourse-native-user-port.ts","lite/src/media/reader-katex-controller.ts","lite/src/media/reader-poll-model.ts","lite/src/media/reader-cooked-content-feature.ts","lite/src/translation/reader-translation-controller.ts"]
since: 0.1.2
version: 1.5.1
status: current
last_verified: 2026-08-16
screenshots: ["/screenshots/guide-03-image-settings-v1.5.0.png", "/screenshots/guide-19-image-lightbox-v1.5.0.png", "/screenshots/guide-25-user-card-v1.5.0.png"]
---

# 图片、媒体与富内容

## 帖子图片

正文图片比例可以按浮窗、全屏、移动分别保存，范围为 50%–200%。比例只影响帖子内显示尺寸，不修改远端图片。

![图片设置中的显示比例、灯箱原图和评论面板选项](/screenshots/guide-03-image-settings-v1.5.0.png)

<p class="image-caption">打开“设置 → 图片设置”，分别调整浮窗、全屏和移动布局的图片比例，并决定灯箱是否默认加载原图。</p>

点击图片进入灯箱。常用操作：

| 操作 | 控件或快捷键 |
| --- | --- |
| 放大 / 缩小 | `+` / `-` 或顶部按钮 |
| 适应窗口 | `0` 或重置按钮 |
| 前后翻图 | `←` / `→` 或两侧按钮 |
| 查看原图 | “查看原图”按钮 |
| 回到楼层 | “跳到楼层”按钮 |
| 关闭 | `Esc` |

![原图灯箱、图片序列、工具栏、描述和关联评论](/screenshots/guide-19-image-lightbox-v1.5.0.png)

<p class="image-caption">点击正文图片后，使用顶部工具栏缩放、重置、下载或返回楼层；底部缩略图用于前后翻图，右侧面板显示描述和关联评论。</p>

## 原图、描述与评论

- **原图**：默认先用预览图；可在设置中改成每次灯箱都优先取原图。
- **描述**：可以展开、收起并拖动底边调整高度，状态会保存。
- **关联评论**：评论面板按图片所在楼层查找直接关系；数据缺失时按需补取主题楼层并建立评论树。
- **评论回应**：在评论树中查看回应数量，点击当前回应可取消，打开回应选择器可切换；提交后与正文对应楼层同步。
- **评论宽度**：拖动分隔线调整，允许范围为灯箱宽度的 18%–50%。

原图或来源楼层加载失败时，灯箱会保留现有预览并给出重试/不可用状态。来源楼层 404 不一定意味着 CDN 图片已经失效。

## 下载

- 单张下载优先复用阅读器缓存；需要原图时，按阅读器限速获取后再保存。
- 批量下载进入多选状态，再处理选中的图片。
- 浏览器可能根据安全设置询问保存位置或拦截连续下载。

下载只在用户明确操作后发生。大量原图会占用带宽和浏览器资源缓存。

## 头像与资料媒体

点击用户头像可以打开独立预览器，支持缩放、前后翻看和下载。头像缓存与帖子原图缓存分开管理。

![阅读器用户卡与头像原图预览器同时打开](/screenshots/guide-25-user-card-v1.5.0.png)

<p class="image-caption">先点击作者用户名打开用户卡，再点击卡片中的头像进入原图预览；右上角按钮用于下载或关闭。</p>

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
- 超过 10 行的代码块默认只显示前 10 行，并提供“展开全部 N 行”按钮；再次点击可收起，阅读器会尽量保持当前楼层和滚动位置不跳动。

## Onebox 与特殊内容

主题链接卡片、内联 Onebox、SVG、Markdown 提示块、已解决答案和部分系统事件沿用阅读器统一内容样式。第三方 iframe 或嵌入内容仍受浏览器 CSP、跨域和原站策略约束。

GitHub 仓库 Onebox 会整理为更紧凑的阅读结构：仓库缩略图移动到来源行，标题和说明保持单行节奏，并移除重复缩略图。点击卡片中的链接仍会打开原始 GitHub 页面，阅读器不会复制或改写仓库内容。

## 跨语正文翻译

站点适配支持中文、英文及其他语言的标准 Discourse 社区，不受内容语言限制。当前翻译功能会在非中文内置社区和语言未知的自定义 Discourse 站点显示翻译按钮，将正文译为简体中文，无需离开帖子或复制正文；内置中文站点 LINUX DO 隐藏该入口。每次点击按以下顺序切换：

1. 原文；
2. 原文与中文译文上下对照的双语模式；
3. 只显示简体中文译文；
4. 回到原文。

翻译只处理普通正文段落、列表、标题、引用和表格文字，会跳过代码、公式、投票、Onebox、表单以及过短或类似标识符的文本。未配置 API Key 时，请求按批次发送，优先使用 Google，较大批次或失败时回退 Microsoft；译文最多缓存 240 条到中央 Section 缓存。关闭阅读器会取消尚未完成的请求。

“设置 → AI 服务”独立维护供正文翻译、帖子总结等功能共用的 OpenAI 兼容 API URL、Key，并把每个供应商 `/models` 返回的模型目录与可用元数据分别缓存下来；只读下拉会优先按输出模态、基准、上下文和发布时间分组排序，元数据不足时才按名称推断，这里不指定全局模型，也不提供跨供应商官方能力排名。“设置 → 翻译设置”可切换双语译文样式和动画，并从按供应商 URL 分组的目录中单独选择正文翻译模型，再维护该供应商的温度、思考等级、RPM / TPM 与翻译 Prompt。帖子自定义总结也在自己的窗口单独选择供应商与模型，因此不会被翻译选型绑定。Key 留空时正文翻译继续使用公共服务；选择有效的自定义模型后只使用对应 AI 服务，失败不会静默切换到公共接口。

翻译是第三方机器翻译，可能存在遗漏或语义错误；涉及命令、金额、权限和安全操作时应切回原文核对。自定义站点没有可靠语言标记，入口仍会显示；中文自定义站点可保持原文模式，不触发第三方翻译请求。启用 WebDAV 的“AI 服务集合”时，API Key 会使用 WebDAV 应用密码加密；“已翻译 Section 缓存”是另一个独立开关，不包含原文。
