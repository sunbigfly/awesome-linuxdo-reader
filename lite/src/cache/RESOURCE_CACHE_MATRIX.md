# mian-lite 资源、缓存与更新矩阵

审计边界仅为 `lite/src` 与 `lite/tests`。本文件记录源码中的远端读取、派生数据、持久状态、缓存身份、读取者和更新路径；生成文件只承载这些模块，不另建资源 owner。

## 中央契约

- 所有自动读取的 Discourse/外部资源由 `DomainRequestGateway` 归一为 Topic、楼层、二级回复、通知、集合、用户、翻译或公共资源请求，再进入 `CoordinatedRequestClient` 的 scheduler、single-flight、429/challenge、timeout 和 AbortSignal 链。
- `ResponseRepository` 是远端响应唯一缓存 owner：application 内存 LRU 上限 96 项/24 MiB；IndexedDB `linuxdo-enhanced-reader:responses:v1` / `responses` 上限 600 项/96 MiB。fresh 命中不联网，stale 默认尝试联网且失败回退旧值，retain 超期才删除。持久层每 32 次成功 write/merge 主动执行一次过期、条数和字节淘汰，quota 时立即淘汰并重试。
- Response 之上的业务热缓存不再被当成“只是 View 状态”：当前 TopicSession、通知分页（最多 32 页）、收藏/回应完整集合、用户资料/关注/外部摘要（最多 32 个用户）、用户观察归一化历史分页、图片 Object URL（最多 32 个）和 LDC 兼容 bridge 都有明确统计与清理生命周期。清理会先让晚到异步结果失效，再释放投影；不能只删 IndexedDB 后继续命中旧内存。
- 持久缓存提交与失效通过 `linuxdo-enhanced-reader:cache-coordination:v1`、BroadcastChannel 和 Web Locks 跨标签同步；成功的 `write`、`restore`、`merge` 都让其他标签丢弃同 ID 的旧 memory LRU。分页投影的新 generation 物理页静默落盘，最终 manifest 只广播一次，避免逐页消息风暴。账号相关远端身份都含 `authScope`。已登录文档固定使用 `account:<username>` 并按账号隔离，未登录文档按站点统一使用 `anonymous:<origin>` 并在匿名标签间共享；两类 scope 绝不互读。翻译按内容指纹隔离，公共图片按绝对 URL/variant 隔离，二者不含账号数据。
- mutation、权限探测和已读提交一律 `no-store`，不能用旧响应代替服务端权威结果。

## 远端与派生资源

| 资源 | 请求与身份 | 存储 / fresh / retain | 使用者 | 在线更新、失效与长时恢复 |
| --- | --- | --- | --- | --- |
| Topic JSON | `TopicReadRequestAdapter.loadTopic`；`authScope + topicId + topic-refresh` | `discourse-topic-json`，30 分钟 / 7 天；同时归并 Topic 快照 | `TopicSession`、标题/时间线/权限/stream | `/topic/:id` MessageBus、composer 与动作按 `topic:id` 失效并写 canonical；完整快照 30 分钟内重复打开零请求，超期后台刷新 Topic JSON |
| 楼层批次 | `loadPostsByIds`；`authScope + topicId + sorted postIds` | `discourse-topic-posts`，30 分钟 / 7 天；tags 含 `topic:id`、`post:id` | 虚拟滚动、引用、图片索引、回复树、Boost | MessageBus 正文事件只刷新已加载楼层（新建楼层除外）；回应回声跨 channel 全局去抖、至多 20 楼单批后台重取，失败即熔断本 Topic 本轮自动回应刷新；已加载楼层的 `boost_added` / `boost_removed` 直接归并 canonical delta，未加载楼层不补不可见请求；显式 `refresh:true` 即使已有正文也重取，失败保留 canonical stale 正文 |
| 最新/目标楼层 | `loadPostById`、target candidate；`authScope + topicId + operation + postId/postNumber` | 与楼层缓存相同；权威定点刷新不接受旧响应冒充成功 | 跳楼、通知/收藏打开、冷启 recent-first | 超期完整快照只在 Topic JSON 后定点刷新 stream 最后一个 `post.id`，不重拉全部历史楼层 |
| 二级回复 | `loadNestedReplies`；`authScope + topicId + parentPostNumber + parentPostId + after` | `discourse-topic-replies`，30 分钟 / 7 天 | 楼中楼、回复线、完整树补齐 | 父帖/Topic 事件定点失效；只在展开、临近预取或显式全树操作时读取，stale 失败回退 |
| Post Voting 评论 | `loadPostVotingComments`；账号、`postId`、cursor/page | 复用楼层 policy 与 `post:id` tag | 投票评论 UI | 用户翻页或刷新时读取；动作/帖子事件按 `post:id` 失效 |
| Topic canonical 快照与回复树 | 无额外网络；ID 为 `authScope|snapshot:topic:topicId` | `topics`，30 分钟 / 30 天，包含 Topic、stream、正文、墓碑、树和 observedAt | Topic 冷启和全部 canonical readers | HTTP、MessageBus、composer/action 共用版本仲裁并 merge；单纯恢复/重写回复树不得把远端 freshness“碰新” |
| 通知、私信、收到的回应 | `DiscourseNotificationRequestAdapter`；`authScope + group + page`，合并回复另走 Topic target | 原始页 `discourse-notification-page` 为 30 分钟 / 180 天；另按账号、分类和 60 条归一化物理页永久保存历史投影，远端断点同时记录页大小及绝对 offset；controller 内存最多 32 页 | “收藏与回应”通知面板 14 分类 | 启动 authScope 优先读取 Discourse preload currentUser；anonymous runtime 不挂载私人集合。application 空闲期先恢复账号投影并补齐缺失断点；面板打开后以最多 3 个连续 worker 补齐不同分类，已知连续 `user_actions` 缺页也在同一总预算内并行读取。若完整断点声称的 offset 与实际投影条数矛盾，则保留已有记录并自动从头重建断点，不能继续显示“历史已到底”。账号级短批次 hydration lease 保证同一时刻只由一个标签抓取；consumer 丢弃当前标签的旧内存 manifest 后重读 IndexedDB。`notifications:changed` 只失效并刷新原始头页，不删除稳定投影；私信投影只留本机，不进入 WebDAV |
| 收藏 | `/u/:username/bookmarks.json`；`authScope + bookmarks + page + username` | 原始 `discourse-bookmark-collection` 为 30 分钟 / 7 天；另按账号、来源和历史流永久保存归一投影，断点原子绑定页号及 cursor | 收藏面板，本地搜索/分页 | anonymous runtime 不挂载私人集合。application 空闲期恢复账号投影并从缺失断点续传；面板打开后以最多 3 个连续 worker 并发补齐来源，关闭后降为单来源后台续传。账号级短批次 hydration lease 避免重复全量抓取；consumer 强制重读共享持久投影，writer 换手也先合并最新世代；回复 offset 随页码递增，Boost / 插件回应 before cursor 随页码递减，旧标签写回不得把两类水位反向覆盖；`bookmarks:changed`、回应及本地 Boost/回复成功事件只刷新受影响来源 |
| 我给出的点赞/自定义回应 | reaction model + `user_actions`；账号、collection、page/cursor、username | 原始响应与收藏相同；回复、Boost、回应按 100 条请求并各自进入永久账号归一分页投影 | 回应面板、表情计数筛选 | 切换先恢复投影；插件事件只标记来源待校验，完整来源成功后替换，断点页按 identity 合并。WebDAV 活动历史应用后也回写同一投影 |
| 用户资料 | 原生 user summary；`authScope + username + profile` | `users`，30 分钟 / 24 小时；application 最多 32 个用户 | 用户卡、设置用户页、动作状态 | 30 分钟内 application 直接命中；超期经中央缓存校验。关注/静音/忽略/认可 action 直接归并内存并定点失效；其他标签的资料提交或关系失效会同步废弃对应用户的 application 热缓存，可见用户优先复用新持久响应；失败保留 stale 用户卡 |
| 用户观察公开历史 | 七类公开活动分页与 `/latest.json?topic_ids[]=` Topic 元数据批次；账号、username、stream/page/cursor 或最多 100 个 topicId | 原始页和元数据走中央响应缓存，7 天 / 180 天；归一化历史按 60 条分页永久保存在用户观察 IDB 投影，session 仅保留最近 120 条 | 用户观察八个 Tab、月活跃日历、搜索与类别/标签筛选 | 每个用户逐来源串行采集；同账号同用户以整段 hydration lease 避免多标签重复请求，consumer 只恢复 producer 的持久投影。分页 writer 另用账号/用户租约，接棒时强制读取最新 manifest/page，generation 含标签随机 nonce，最终 manifest 广播后才修剪旧世代。Topic 元数据统一分批并复用中央 scheduler、429 和 challenge 恢复；权威空 tags 标记为确实无标签，未确认记录保留待更新状态 |
| 徽章、目录统计 | `user badges`、directory stats；账号、username、resource | 与用户资料相同且按 `user:username` 失效 | 用户卡完整徽章和统计 | 与 profile 并发/按需补齐；可选徽章失败不清空基础资料，统计失败形成 partial |
| 关注/粉丝完整集合 | user follow list；账号、username、kind | 与用户资料相同，30 分钟 / 24 小时；内存另记录每 kind 的更新时间 | 用户卡关注面板，本地搜索/分页 | freshness 内只做本地分页；超期重校验。follow action 同时失效目标 followers 与当前用户 following；空集合与资料计数冲突时强制校验 |
| Connect 信任摘要 | 固定带凭据 `https://connect.linux.do/`；账号、username、resource | `external-user-summary`，30 分钟 / 24 小时 | 设置用户页 Connect tab | 无可靠站点事件，打开时按 freshness 校验；账号不一致拒绝写入，失败映射 stale snapshot |
| LDC 账户摘要 | 固定带凭据 credit user-info；账号、username、resource | 中央 `external-user-summary` 30 分钟 / 24 小时；兼容 GM bridge `awesome-linuxdo-reader:ldc-user-bridge:v1` 30 分钟 | 设置用户页 LDC tab | 无可靠事件，打开/显式刷新时校验；账号不一致拒绝消费。bridge 过期即回收，用户资料清理同时清中央响应、会话投影和 bridge，晚到请求不能复写已清记录 |
| 可认可类别 | 原生 endorsable categories；账号、username | `users`，1 分钟内存 / 5 分钟，不持久化 | 用户认可动作菜单 | 容量变化快且只在动作前需要，短内存缓存；显式刷新可绕过 |
| 翻译 | provider + 文本 SHA 指纹 + source/target language | `translations`，30 天 / 180 天，持久化；Microsoft token 8 分钟内存且不持久化 | 翻译 controller | 内容不可变，命中期间零请求；provider 失败按登记顺序回退。凭据永不写 IDB |
| 原图/预取图片 Blob | 绝对 URL + `preview/original` variant | `images`，24 小时 / 30 天；object URL 最多 32 个 | 灯箱、下载、媒体预取 | 同 URL/variant single-flight；手动重试可 refresh；对象 URL 按 LRU revoke，Blob 由中央 IDB 淘汰 |
| 头像、emoji、帖子内预览图 | URL/template 由 Topic、用户、通知、收藏、历史等记录保存；`<img src>` 直接消费 | 图片字节由浏览器 HTTP cache 管理，不另写 Lite IDB；仅进入灯箱/预取时才走上行 Blob cache | 各 View 与浏览器图片加载器 | 用户/帖子事件更新 URL 后自然重渲染；站点 `site-settings` 与 emoji helper 使用宿主已有 registry，不重复请求 emoji 目录 |
| 站点配置、当前用户、presence | 读取 Discourse 原生 service/model | 只持宿主对象或纯数据快照，不建立第二份远端持久缓存 | 主题、回应目录、在线成员、权限展示 | 路由/宿主 service 与 MessageBus 是权威来源；缺能力时降级为空，不增加轮询 |
| 自定义站点探测 | 用户添加站点时固定匿名 `GET https://host/site/basic-info.json` | application 内存缓存 5 分钟 / 最长保留 30 分钟，`persist:false`；成功后只把 `{host,title}` 写自定义站点配置 | 设置中的“添加站点” | 明确用户动作才请求；同次短时重试复用中央 scheduler/single-flight/内存响应，关闭应用即释放，不写 IndexedDB |
| 宿主分类/标签身份 clone | 不发请求；从当前 Discourse DOM 复制已安全渲染的分类/标签图标与 href | 外层 `WeakMap<Document,...>`；分类 icon/href、标签 icon/href 四个 LRU 索引各最多 128 键 | 历史 Topic 的 Header 在宿主列表 DOM 已换页时补图标/链接 | 每次读写更新 LRU；“帖子与楼层内容”展示分类/标签派生数并清整个 Document 索引；Document 回收时外层自动释放 |

## 本地状态资源

| 状态 | key / 上限 | 使用与更新 | 账号与淘汰结论 |
| --- | --- | --- | --- |
| 阅读历史 | `linuxdo-enhanced-reader:history:scope:v2:<authScope>`；365 天；quota 从最旧项收缩 | 打开/读到楼层后累计标题、作者头像模板和已读楼层；面板与前后导航只读 repository | 首个已登录账号通过 legacy-owner 标记无损复制旧 key；之后账号隔离。旧 key 保留，scoped 空 tombstone 防止清空后复活 |
| 阅读队列 | `linuxdo-enhanced-reader:reader-queue:v1:scope:v2:<authScope>` | 保存 pinned/排队元数据；正文、树和媒体不进入该记录，预取仍走 Topic 中央缓存 | 与历史共用 legacy claim/copy-on-read 协议，账号 A/B 独立，空队列也保留 scoped tombstone |
| Topic 窗口几何/锚点 | `linuxdo-enhanced-reader:reply-window:v1:scope:v2:<authScope>`；最多 128 个 view | 保存 host/topic/root 的滚动锚点与窗口几何 | 首个已登录账号无损复制旧几何/锚点；其他账号从空状态开始，LRU 各自保留最近 128 项 |
| 离线 Topic Artifact | `reader-topic-offline-artifacts:manifest:scope:v2:<authScope>` 与 `reader-topic-offline-artifact:scope:v2:<authScope>:<topicId>`；永久 | 当前账号的轻量目录与完整 HTML；显式移除才删除，普通响应缓存清理不触及 | 同站点账号隔离；正文覆盖、目录合并和删除都广播对应 ID，其他标签不会继续命中旧 HTML/manifest；首个已登录账号通过持久 legacy-owner 无损复制旧无账号目录，其他账号不可读取或重复认领；WebDAV 继续使用同一账号 scope |
| 偏好 | `linuxdo-enhanced-reader:prefs` | `PreferencesRepository` 原子读写、normalize、跨页面同步 | 设备级而非账号级，属于用户明确设置，不按远端账号分裂 |
| 自定义站点 | `awesome-linuxdo-reader:custom-discourse-sites:v1` | GM value storage 保存已验证 `{host,title}` | 设备级用户配置；仅显式增删改写 |
| Connect 信任观察历史 | `linuxdo-enhanced-reader:connect-trust-history:v1:scope:v2:<authScope>`；本地观察最长 400 天，界面投影 50 天 | 保存本机观察到的 Connect 指标首末值和已确认阅读指纹；服务端 user-actions 另走 10 分钟 / 24 小时中央响应缓存 | 账号隔离、不可由服务端完整重建，属于用户本地数据；“用户资料卡”清理只删可重取的服务端响应，不删除这份观察历史 |
| LDC 兼容 bridge | `awesome-linuxdo-reader:ldc-user-bridge:v1`；30 分钟 | LDC 页面同源桥与 Reader 中央请求的短期兼容交接，只保存白名单数据和 `cachedAt` | 可重新获取；过期加载主动置空，设置“用户资料卡”清理也会置空，并以 epoch 阻止晚到请求复写 |
| 已读成功协调 | `linuxdo-enhanced-reader:read-success:v1`；默认 60 秒/16 条 | 防止跨标签重复提交 timings，包含 `authScope + topicId + postNumbers` | 短期淘汰、账号隔离；服务端提交仍 no-store |
| cache/request 协调 | cache coordination、request permit 的固定 storage/channel/lock key | 只保存租约、限流和失效元数据，不保存响应正文 | 有 TTL、条数上限和 sourceId；用于跨标签 single-flight。通知、收藏历史和宿主 Topic 近视口预热共用 application 级页面活跃信号；隐藏标签不启动或续跑后台联网，恢复后从共享 IndexedDB 与断点接管 |
| embedded reload handoff | `ldp:mian-lite:embedded-reload:v1`，短 TTL，读取即删 | iframe/嵌入模式重载时传递一次性目标 | 临时导航状态，不是资源缓存 |
| 兼容 CacheStorage 目录 | 三个固定 avatar/emoji/original cache name | 设置页仅统计或由用户清理；Lite 不再向这些 bucket 写 Blob | 只读兼容目录，不能视为 Lite 的第二份图片 cache |

## 明确保留的取舍

1. 收藏与“我给出的回应”端点没有稳定的增量 cursor 快照或携带完整增删 payload 的 app-event。只刷新第一页会在删除、跨页位移时产生错误总数，因此采用 30 分钟 fresh + 在线事件精准失效 + 可见时从持久断点并发完成权威合并；stale 仍可显示。
2. 普通 `<img>` 请求属于浏览器资源加载，强行全部改成 Blob/object URL 会复制内存、破坏懒加载和浏览器 HTTP cache，故只对灯箱、下载和显式媒体预取使用中央 Blob cache。
3. 历史、队列和 Topic 锚点的旧 key 无法证明原始账号归属，因此只允许首个完成升级的已登录账号声明并复制；其他账号绝不读取 legacy。旧 key 不删除，避免迁移失败造成数据损失。
4. 自定义站点探测只在用户点击添加时发生，使用固定匿名 endpoint；它不参与后台资源生命周期，因此不为一次性探测建立持久缓存。
5. 拼音搜索最多 512 个字符串投影、DOM/图片解析 WeakMap、请求 single-flight、scheduler 队列和各类 pending Map 都是有界或随 scope 销毁的派生 memo/进行中事务，不是可跨会话命中的业务数据缓存；设置页不把它们冒充可删除的本地记录。
6. 浏览器自己的 HTTP cache 承担普通头像、emoji 和正文 `<img>` 字节；Lite 既没有其精确目录也不能选择性删除。设置页只管理中央图片 Blob、Object URL 和三个明确 allowlist 的旧 CacheStorage bucket。

## 会话派生、诊断与进行中 registry 穷举

下表是对 `lite/src` 237 个 TypeScript 文件机械扫描 cache/memo 命名、88 个 storage/capability 调用和 139 个含 Map/Set 构造文件后的分类。这里的 Map/Set 不能一概当成用户数据缓存；每类都给出 owner、上限或释放边界，避免“未进设置页”变成未解释遗漏。

| 类别 | owner / 代表字段 | 上限与失效 | 是否进入数据管理 |
| --- | --- | --- | --- |
| 中央响应与写 flight | `ResponseRepository.#memory/#writes`、IndexedDB store、`CrossTabCacheCoordinator` flights | 内存 96/24 MiB、持久 600/96 MiB；writes 完成即删；flight TTL/stale + 最多 128 | 是：六类目录/失效；flight 是协调元数据，不计内容记录 |
| 当前 Topic canonical | `TopicSession.#postById/#postByNumber/#unavailablePostNumbers`、`ReplyTreeRepository`、`TopicSnapshotRepository` 内存实体与 pending write | 单 Topic scope；切帖/关闭销毁；unavailable 只在当前会话；snapshot flush 后持久层按策略管理 | 当前会话计 1；帖子分类通过 close/flush/rebuild 释放，不能直接清 Map 破坏正在阅读的实体 |
| Topic 显示投影 memo | `ReaderReplyTreePresentation.#cachedRoots/#cachedRootBranches/#cachedHiddenFloorRunsAfter` | 只对应当前 canonical/projection revision，revision 改变整份替换，Topic scope 释放 | 否：纯计算投影，无跨会话命中 |
| Topic DOM/几何窗口 | `ReaderTopicDomCoordinator.#retainedViews`、direct-reply prefetch registries，`ReaderTopicContextSurface.#discussionMaterializedLru`，virtual/reply layout 的 measured/index Map | retained view 跟随性能 `maxMountedPostCount`；完整讨论 materialized 默认至少 24、通常 eager×3；其余跟当前 mounted roots/observer/scope 清理 | 否：DOM/测量与当前交互状态，不是可重取响应；强清会破坏当前视图 |
| immutable 解析 memo | `ReaderTopicImageIndex.#parsed`、`ReaderLightboxCookedCommentMatcher.#referencesByPost` | `WeakMap<post object,...>`；post/scope 不再被引用即回收；cooked 变化重新解析 | 否：无可枚举强引用、无持久数据 |
| 宿主身份派生 | `reader-topic-header` 的 Document WeakMap + 四个 inner LRU | 每索引 128；读写 touch；帖子分类显式 clear；Document GC 兜底 | 是：归帖子分类，展示分类键/标签数 |
| 拼音搜索投影 | `BrowserUserscriptEnvironment.createPinyinSearchForms()` closure Map | 512 字符串 LRU；application bindings 释放后回收 | 否：跨历史/通知/收藏/用户共享的 CPU 派生，不能在单分类清理中假装有精确归属 |
| 图片 Object URL | `ReaderImageResourceService.#sources` | 默认 32 LRU；refresh/源失效/图片分类/scope destroy 都 revoke | 是：归图片分类 |
| 业务集合热缓存 | notification pages、bookmark/reaction arrays、user entries/follow/external maps、LDC bridge | 32 页、32 用户、完整当前集合、bridge 30 分钟；epoch/abort/timer/scope 门禁 | 是：分别归通知、其他数据、用户资料 |
| 请求与动作进行中 registry | scheduler `#tasksByKey`、client `#requests`、Topic pending loads、translation queue、post/action/share/bookmark flights、RepeatActionGate deadlines | 完成/abort/destroy 即删；scheduler queueLimit；只保存 Promise/计时/意图，不保存可再次消费的成功响应 | 否：进行中事务；用户清理内容缓存不能取消无关 mutation |
| 请求事实与性能诊断 | `RequestObserver.#events/#active`、`ReaderResourceMonitor` samples/evidence/visibility | 默认 5 分钟/500 个完成请求（pending 保留）；资源趋势 10 分钟、evidence 最多 1,200 | 不进六类数据缓存；日志页有自己的 completed 清理/active-scope 生命周期 |
| View/DOM/lifecycle registry | 各 View 的 element→state Map、listener Set、PostView WeakMap、frame/timer Map、Signal listeners | 归所属 `LifecycleScope`；destroy 反向释放，WeakMap 不阻止 GC | 否：UI owner 状态，不是业务缓存 |
| 单次计算与静态 catalog | normalize/dedupe 用局部 Map/Set，动作 descriptor、设置 schema、保留键集合等 module 常量 | 单次调用返回后 GC；静态 catalog 大小由源码固定 | 否：无运行时增长或跨请求陈旧命中 |

## 设置数据管理控制面

| 设置分类 | 统计层 | 清理层 | 明确保留 |
| --- | --- | --- | --- |
| 浏览历史与岁月史书 | 账号隔离 History 条目、本机仍有可定位内容的删除及 403/404/410 事件、主题数与估算字节 | `ReaderHistoryRepository.clear()` + `ReaderChronicleRepository.clear()`（手动清理；正文消失的史书记录读取或点击时自愈移除） | 阅读队列、Topic 正文/快照、Topic 锚点/几何、偏好、自定义站点、浏览器访问历史；收到失效信号不触发正文清理 |
| 帖子与楼层内容 | 中央 Topic/Post/Tree 记录 + 当前 TopicSession + 宿主分类/标签派生 LRU | 中央分类失效；若当前有主题，先结束旧 session 并 flush，再按 `topic:id` 精确失效并联网重建；最后清宿主身份 LRU | 历史、队列、偏好；分类清理不额外清图片，顶部“清除当前帖子缓存并刷新”才同时清该 Topic 图片 |
| 用户资料卡 | 中央 user/external response + 用户域热缓存 + LDC bridge | 中央分类失效、用户 session epoch 清理、LDC bridge 置空 | Connect 400 天本机观察历史、原站账号资料、头像字节 |
| 通知与消息 | 中央通知/展开记录 + controller 32 页热缓存 | 中央分类失效、取消后台 warm/live timer、load epoch 清理分页与投影 | 原站真实通知与私信 |
| 收藏、回应与其他数据 | 中央收藏/回应/翻译/短时通用响应 + 收藏 controller 完整集合 | 中央分类失效、取消收藏 load/live 并清完整集合 | 原站真实收藏、回应与点赞 |
| 头像、表情与原图 | 中央图片 Blob + Object URL + 三个旧 CacheStorage allowlist | 先清旧 bucket，再失效中央图片记录并 revoke Object URL | 普通 `<img>` 的浏览器 HTTP cache、帖子线上图片 |

目录统计是清理决策的一部分：IndexedDB 目录不可读时必须显示“统计失败”，选择性清理不得把未知持久状态当空目录；全选所有 response 类别仍可直接执行 `all` 失效。每层清理失败都保留对应勾选并报告部分完成，不能以成功 toast 掩盖持久层、广播层或应用热缓存失败。
