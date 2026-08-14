# Runtime observability

## 目标

把宿主、userscript 和 Tampermonkey 扩展后台的活动分开记录，再用同场景 A/B 基线判断 userscript 增量。页面级工具看不到或不能准确归因的内容必须标明限制。

## 请求分类

| 分类 | 典型来源 | 主要证据 |
| --- | --- | --- |
| `host` | Discourse 页面脚本、路由、MessageBus | URL、类型、Initiator 不指向本地 userscript |
| `userscript-fetch` | userscript 的 `fetch`/XHR | Initiator、userscript 文件、内部调用点 |
| `tampermonkey-gm` | `GM_xmlhttpRequest` | Tampermonkey Service Worker Console/Network |
| `external-resource` | CDN、字体、图片、媒体、`@require` | 域名、资源类型、缓存与传输量 |

不要通过添加自定义请求头来归因，避免触发 CORS 或改变生产行为。优先使用 Initiator、调用栈和 debug-only 内部度量。URL 默认只保留 origin 与 path；查询参数、Cookie、Authorization、正文和用户数据不得进入报告。

## A/B 场景

1. 固定页面、登录态、窗口尺寸和缓存条件。
2. A 组关闭本地调试脚本，刷新后执行场景。
3. B 组开启本地调试脚本，刷新后执行相同场景。
4. 建议场景：打开主题 → 打开阅读器 → 滚动加载 → 展开楼中楼 → 打开/关闭媒体 → 关闭阅读器；重复 5–10 次后空闲 30 秒。
5. 分别保存摘要，不自动导出 HAR。若必须导出，先说明 HAR 可能包含登录和内容数据，只保存在本机。

## Network

记录：method、sanitized URL、resource type、status、cache、transfer size、queued/stalled/duration、initiator、取消原因、retry、429、in-flight peak。

检查：

- 同一用户动作是否产生无原因重复请求。
- 操作结束后队列和 in-flight 是否回到零。
- 429 是否进入冷却，是否存在并发重试风暴。
- 预取、缓存和宿主原生请求是否被误归因为脚本请求。
- `GM_xmlhttpRequest` 是否只能在扩展后台看到。

检查 Tampermonkey Service Worker 会使其保持活跃并影响生命周期测量；完成 GM 调试后关闭对应 DevTools，再测试正常终止。

## Performance

先用 Performance Monitor 观察 CPU、JS Heap、DOM Nodes、Event Listeners、Documents/Frames、Layouts/sec 和 Style recalculations/sec。再对可复现的慢操作录制 Performance trace，定位长任务、强制布局、重复渲染和脚本调用栈。

同时记录宿主基线。只因一次 CPU/heap 峰值不能判定回归；比较相同动作、相同时间窗和重复轮次。

## Memory

1. 清空 Console 中保留的 DOM/对象引用。
2. 记录操作前 Heap Snapshot。
3. 重复打开/关闭场景并等待异步清理。
4. 触发 GC 后记录第二份 Snapshot，使用 Comparison 和 `Detached` 定位增长。
5. 若增长持续，用 Allocations on timeline/Allocation sampling 定位函数。
6. 结束后关闭不再需要的 Snapshot，避免观测工具本身占用大量内存。

正常 GC 锯齿不等于泄漏。重点是 GC 后存活堆、DOM 节点或监听器是否每轮单调增加，以及 Retainer 是否指向 userscript 的闭包、缓存、Observer、事件处理器或 Object URL。

## 通过标准

- 功能场景正确，宿主原有导航、请求和交互没有回归。
- 没有未解释的异常、重复请求或重试风暴。
- 操作结束后脚本队列清空，监听器/DOM 增量有界。
- GC 后存活堆不呈稳定阶梯式上涨；无新增可归因的 Detached DOM。
- 性能 trace 中新增长任务有明确理由或已修复。
- 报告清楚区分自动证据、手动观察和未验收项。
