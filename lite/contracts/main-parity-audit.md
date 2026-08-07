# Main / Lite 业务与渲染对齐审计

审计基线固定为当前工作区的 `work/main.js`、`work/main.css`。Lite 可以采用更稳健的 owner、缓存和虚拟化实现，但最终可见语义、动作入口与状态转换必须与 Main 等价；树状嵌套取代父楼层预览属于已确认的 Lite 优化。

状态含义：

- `static-complete`：源码、契约和样式 ownership 已闭环。
- `lite-browser`：已在 9222 Lite 的真实 LinuxDo 页面复验。
- `browser-recheck-pending`：相关源码或生成物已在最后一次浏览器取证后变化，必须在当前构建上重新实测；不能把历史页面或静态结果写成当前运行态验收。

## 本轮 21 项问题矩阵

| ID | 对齐目标 | Main 基线 | Lite owner | 契约证据 | 2026-08-04 状态 |
|---|---|---|---|---|---|
| P01 | “打开原帖”必须进入当前 Topic，而不是站点首页 | `.ldp-open` / Topic 原生 URL | `discourse/native-host-api.ts`、`app/reader-browser-runtime.ts` | `discourse-native-host-api.test.ts` | static-complete；Main/Lite A/B：Topic 2640404 均为 `https://linux.do/t/2640404?ldp_native=1` |
| P02 | Markdown `>[!TYPE]` Callout 类型、图标、折叠与正文结构对齐 | `prepareReaderCallouts()` | `media/reader-cooked-content-feature.ts`、`60-media.css` | `reader-cooked-content-feature.test.ts` | static-complete；Main/Lite A/B：Topic 2640404 首帖均为 4 个 Callout、内部共 10 个 SVG |
| P03 | Topic 分类/标签保留宿主 SVG/icon | Topic nav metadata 与 `.ldp-topic-tag` | `topic/reader-topic-header.ts`、`20-shell.css` | `reader-topic-presentation.test.ts` | static-complete；Main/Lite A/B：Topic 2703711 均显示可点击的“运营反馈 + 公告”；历史恢复的 Topic 2640404 也已按 category id/tag name 补齐 5 个链接，分类和“软件开发”各保留 1 个宿主 SVG |
| P04 | 普通 Discourse 引用标题、头像、正文块样式对齐 | `prepareReaderPostQuotes()` | `topic/reader-topic-context-surface.ts`、`40-reply-tree.css` | `reader-topic-context-surface.test.ts` | static-complete；Main/Lite A/B：同 Topic 引用结构/尺寸一致；Lite 跨 Topic 引用入口可从 2703711/#1 打开 253414/#1 |
| P05 | 嵌入态刷新/关闭后恢复最近历史 Topic，而不是空白 | Main embedded history restore | `userscript/mian-lite-bootstrap.ts`、`app/reader-browser-runtime.ts` | `reader-embedded-reload-coordinator.test.ts`、`reader-browser-runtime.test.ts` | static-complete；Main/Lite A/B：两端在 LinuxDo 首页强制重载后均自动恢复 Topic 2640404，而非空 Reader |
| P06 | GitHub Onebox 与其他 cooked 正文增强对齐 | `prepareReaderOneboxes()` 及 cooked pipeline | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` | static-complete；Main/Lite A/B：Topic 2640404 均投影 2 个 Onebox，并保留 `githubrepo`、GitHub logo、metadata 与正文层 |
| P07 | 字体默认使用系统字体；恢复按钮不挤压、不竖排 | Font settings / reset controls | `settings/reader-font-settings-form.ts`、`70-settings.css` | `reader-font-settings-form.test.ts` | static-complete；Main/Lite A/B：均显示系统默认字体；恢复控件均为横排，Lite 单项宽度 104–124px、无竖排或挤压 |
| P08 | Esc 只关闭最前层 surface，Shadow Portal 不能漏出竞争 | Main surface stack / Escape handlers | `shell/reader-escape-surface.ts` 及各 surface owner | `reader-escape-surface.test.ts`、`reader-settings-view.test.ts` | static-complete；Main/Lite A/B：灯箱 + 完整讨论同时打开时，第一次 Esc 仅关闭灯箱、第二次仅关闭讨论；设置 Esc 仅关闭设置，三步均保留 Reader。Lite 已覆盖宿主 Window capture 提前截断事件的真实页面路径 |
| P09 | 隐藏楼层的卡片、入口和展开状态对齐 | Main hidden-reply projection | `topic/reader-topic-context-surface.ts`、`40-reply-tree.css` | `reader-topic-context-surface.test.ts`、`reader-reply-tree-preferences.test.ts` | static-complete；Main/Lite A/B：首个连续隐藏段均为可见流中的 18px 独立 marker，目标楼层均为 #2/#3；Lite 展开显示 2 个目标，点 #2 后时间轴 1→2 且 Reader 保持打开 |
| P10 | 表情回应第一次点击就显示 picker | Main reaction picker | `post/reader-post-action-feature.ts` | `reader-post-action-feature.test.ts` | static-complete；Main/Lite A/B：Main capability-ready DOM 为 1 个 trigger + 10 个 picker 选项；Lite 真实坐标首次点击即从 `aria-expanded=false` 进入可见 picker，显示同样 10 个选择项，canonical post 的 `current_user_reaction` 仍为 null，未误发回应；Esc 后只关闭 picker、Reader 保持打开 |
| P11 | 二次展开收纳箱时保留全部次级动作 icon | Main topic action rail | `post/reader-topic-action-rail.ts`、`20-shell.css` | `reader-topic-action-rail.test.ts` | static-complete；Main/Lite A/B：首次展开显示回应、回复、复制楼层、两类举报、负责人、分享和书签等入口，二次收纳仍保留回复/书签 |
| P12 | 主楼正文下不重复动作栏；“评论”数量为 max floor - 1 | Main 主楼 rail/comments header | `post/reader-topic-action-rail.ts`、`topic/reader-topic-comments-header.ts` | `reader-topic-action-rail.test.ts`、`reader-topic-comments-header.test.ts` | static-complete；Main/Lite A/B：Topic 2640404 两端均显示评论（113）；Main #1 仍有基线 `.ldp-reactions`，Lite #1 direct action owner 数量为 0，已迁移入口只保留在主题 rail |
| P13 | 回复入口调用 LinuxDo 原生 Composer，并由 Reader 浮窗完整接管 | Main `waitForNativeComposerPopup()` + native window `open()` | `discourse/native-composer.ts`、`discourse/reader-native-composer-window.ts` | `discourse-native-composer.test.ts`、`reader-native-composer-window.test.ts` | static-complete；Main/Lite A/B：两端主题回复均打开原生 `#reply-control`；Main 为 1200×567.7、Lite 的 Reader chrome 为 1200×568，均完整位于 1707×843 视口，未读取或提交正文 |
| P14 | 所有 placeholder 字号小于输入正文，不抢视觉层级 | Main placeholder typography | `00-foundation.css`、领域表单样式 | 字体/设置/表单契约 | static-complete；Main/Lite A/B：设置搜索正文均为 11px 视觉基准，Lite placeholder 为 9.46px；领域输入仍由契约保证 placeholder 小于正文 |
| P15 | 嵌入态隐藏全屏切换，浮窗态保留 | Main placement controls | `app/reader-browser-runtime.ts`、`shell/reader-workspace.ts` | `reader-workspace.test.ts`、`reader-browser-runtime.test.ts` | static-complete；Main/Lite A/B：嵌入右侧时两端 `.ldp-layout-toggle` 均 hidden、宽度 0；Lite 切换浮窗后恢复为可见 30px 控件 |
| P16 | 双语模式中文译文块的前缀、分隔和排版对齐 | Main translation renderer | `translation/reader-translation-controller.ts`、`30-stream.css` | `reader-translation-controller.test.ts` | static-complete；Main/Lite A/B：discuss.python.org Topic 108371 首帖两端均有 48 个 owner-owned 双语块，48 组原文/中文逐项完全一致；子节点固定为 `.ldp-translation-original` + `.ldp-translation-text`，display/border/padding/译文颜色签名完全一致。Main 祖先查询多出的 4 个属于嵌套回复，不是首帖漏译 |
| P17 | 树状嵌套启用后不再插入父预览 DOM，父楼层号直接跳转 | 已确认高于 Main 的 Lite 行为 | `topic/reader-topic-context-surface.ts` | `reader-topic-context-surface.test.ts` | static-complete；Main/Lite A/B：Topic 2640404 当前可见树均没有 `.ldp-floor-preview`；Lite 父楼层号保留直接跳转 |
| P18 | 所有命名图标统一 tooltip 使用范围、样式和层级 | Main `setupSettingHelpTooltips()` / icon tooltip | `components/reader-control-tooltip.ts`、`settings/reader-settings-help-surface.ts` | `reader-control-tooltip.test.ts`、`reader-settings-help-surface.test.ts` | static-complete；lite-browser：设置 tooltip 11.04px、4×7px、z=2147483647 |
| P19 | 时间轴、滚轮、资源变高和虚拟窗口不得竞争写滚动位置 | Main virtual stream/timeline | `stream/reply-tree-viewport-layout.ts`、`topic/reader-topic-dom-coordinator.ts` | `reply-tree-viewport-layout.test.ts`、虚拟流契约 | static-complete；lite-browser：原 1048↔2584/1536px 循环消失，静置与上下 Page 滚动均单一稳定状态 |
| P20 | 宿主 Topic label/category SVG 不得被正文规则放大 | Main host label constraints | `font/reader-font-style-controller.ts`、`10-workspace.css` | `reader-topic-presentation.test.ts` | static-complete；lite-browser：30 个可见 Topic 行最大 label SVG 为 14×14 |
| P21 | 回复树收纳后必须保留“+”入口并可恢复 | Main nested branch toggle | `layout/branch-overlay.ts`、`40-reply-tree.css` | `reader-branch-overlay-controller.test.ts` | static-complete；lite-browser：收纳后 aria-expanded=false 且 plus SVG 存在，再点恢复 |

## 原始 16 组闭环索引

| # | 对应矩阵 | 最终状态 |
|---|---|---|
| 1 | P01 | 闭环：原帖链接为当前 Topic 原生路由 |
| 2 | P02 | 闭环：Callout 类型、结构和 SVG 完成 A/B |
| 3 | P03 | 闭环：分类/标签链接及宿主 icon 完成恢复态 A/B |
| 4 | P04 | 闭环：同 Topic 与跨 Topic 普通引用均完成 A/B |
| 5 | P05 | 闭环：两端强刷均恢复最近 Topic |
| 6 | P06 + cooked 枚举 | 闭环：GitHub card 及 Main cooked 后处理全枚举有 owner/test |
| 7 | P07 | 闭环：系统字体与恢复控件布局完成 A/B |
| 8 | P08 | 闭环：灯箱、讨论、设置按最前层依次消费 Esc |
| 9 | P09 | 闭环：隐藏楼层 marker、展开和跳转完成 A/B |
| 10 | P10 + P11 | 闭环：首次回应 picker 与二次收纳功能入口均保留 |
| 11 | P12 | 闭环：#1 无重复 direct action，评论数为 max floor - 1 |
| 12 | P13 | 闭环：两端均调用原生 Composer 并完整位于视口 |
| 13 | P14 | 闭环：placeholder 小于正文并通过全样式契约 |
| 14 | P15 | 闭环：嵌入态隐藏、浮窗态恢复全屏入口 |
| 15 | P16 | 闭环：同 Topic 48/48 双语文本、DOM 和样式签名一致 |
| 16 | P17 | 闭环：树状嵌套不再投影父楼层预览 DOM |

## Main cooked 正文流水线完整枚举

Main 的 `setPostCookedContent()` 以及特殊正文入口会依次使用下列能力。Lite 不复制第二份 cooked，而是在同一 PostView content slot 上组合 feature：

| Main 能力 | Main 入口 | Lite owner | 契约 |
|---|---|---|---|
| 图片轮播 | `prepareReaderImageCarousels()` | `media/reader-image-carousel-controller.ts` | `reader-image-carousel-controller.test.ts` |
| iframe 隔离与来源处理 | `prepareReaderFrame()` | `media/reader-media-controller.ts` | media controller/browser runtime contracts |
| 图片、视频、音频、HLS、灯箱 | `prepareReaderMedia()` | `media/reader-topic-media-feature.ts`、lightbox owners | media/lightbox contract family |
| 代码块复制与预览 | `prepareReaderCodeBlocks()` | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` |
| Hashtag 图标 | `prepareReaderHashtags()` | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` |
| Mention/user-card 语义 | `prepareReaderUserMentions()` | cooked feature + `user/reader-user-card-view.ts` | cooked/user-card contracts |
| Markdown Callout | `prepareReaderCallouts()` | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` |
| 普通 Post Quote | `prepareReaderPostQuotes()` | `topic/reader-topic-context-surface.ts` | `reader-topic-context-surface.test.ts` |
| Inline Onebox | `prepareReaderInlineOneboxes()` | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` |
| GitHub Onebox | `prepareReaderOneboxes()` | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` |
| Link click counts | `decoratePostLinkClickCounts()` | `media/reader-cooked-content-feature.ts` | `reader-cooked-content-feature.test.ts` |
| 翻译、Poll、KaTeX 与特殊正文二次同步 | cooked 完成后的 Main feature 链 | translation/poll/katex/topic-special owners | 对应独立 contract family |

## 当前浏览器边界

- 9222：已强制重载当前本地 `work/mian-lite.local.js` 与 `work/mian-lite.css`；P08 的真实键盘 Esc 链与 P09 的隐藏楼层展开/跳转均在本次生成物复验通过。
- 9223：用户确认本地 Main 基线脚本已启用后，Main 已在 `discuss.python.org` 正常注入并恢复 Topic 108371；LinuxDo 与翻译允许站点的定向 A/B 均已完成。
- 本轮 live tool surface 实际同时提供 9222 Lite 与 9223 Main，运行态优先于会话起始文本中的禁用说明；原始 16 组及扩展矩阵现均有静态/运行态证据，浏览器边界不再包含待复验项。
