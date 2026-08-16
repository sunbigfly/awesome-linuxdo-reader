---
name: develop-lite-reader
description: "在当前 awesome-linuxdo-reader 仓库开发、修改、修复或审查 Lite 阅读器。用户提到 Lite 功能、lite/src、lite/styles、main-lite、本地调试版、Greasy Fork 四文件本地测试版，或要求变更后生成可手动审查产物时使用；每次 Lite 变更都生成单文件本地调试 JS 和 Loader + Core + Platform + Features 四文件本地测试版。不用于提交、push 或线上发布。"
---

# 开发 Lite 阅读器

只处理 Lite 开发与本地审查产物。提交和线上同步交给 `$sync-lite-three-part-release`；旧版 `work/main.js` 交给 `$tampermonkey-dev-assistant`。

## 固定边界

1. 把 `lite/src/`、`lite/styles/` 和 `lite/userscript.meta.txt` 作为事实源；只把 `work/main.js`、`work/main.css` 当作只读对照。
2. 不直接编辑 `work/main-lite*.js`、`work/mian-lite*.js`、`work/main-lite.css`、`work/mian-lite.css` 或 `work/greasyfork-lite/libraries/*.js`。
3. 记录并保留任务前 dirty 路径，只改当前需求的 owner、测试和必要构建配置。
4. 项目有并行任务时，检查、测试和生成只按当前任务的 owner、输入、相关测试和预期产物归因。边界外的 dirty、失败和生成物变化不分析、不修复、不回滚、不重跑、不等待，也不作为本任务阻塞；只有 exact path 重叠、结果无法独立验证或未授权内容会进入本次交付时才停止。
5. 不自动改版本、提交、push、发布或修改 Greasy Fork 设置。
6. 浏览器、DevTools、真实页面和截图仅在当前请求明确授权时使用；本地构建不等于浏览器验收。
7. 当前项目开发和审查以本地版为准；`work/main-lite.local.js` 即使超过 2 MiB 也不拆分、不判失败，不把单文件大小作为设计约束或完成条件。`main-lite:local-debug` 仍按下文生成两套本地产物；只有用户明确切换到 `$sync-lite-three-part-release` 执行线上发布时，才按发布流程核实平台体积限制。

## 请求、渲染与性能规则

1. “触及”仅指当前任务本身需要改动请求、渲染或性能相关内容；调用链只是经过、代码相邻或顺带发现不算触及，不得据此扩大任务范围。
2. 把现有运行性能、请求流控制和渲染正确性作为所有 Lite 实现的不可退化约束。不得绕过或削弱既有快速路径、缓存与去重、批处理、并发与节流、统一调度、重试及 429 恢复，也不得无必要增加请求、串行等待、重复渲染、热路径工作或常驻监听。
3. 当前任务确实触及时，先用直接源码、调用链、最小测试或运行证据确认因果、收益和安全边界。只要证据能够证明某项具体提升可行，并能保持业务语义、请求控制、渲染正确性和既有安全边界，就必须在对应 owner 内窄落实；即使提升较小，也不因该区域敏感而回避。
4. 上下文不足、收益只属推测，或改动需要改变业务行为、请求语义或风险边界时，不擅自实现；报告证据缺口和影响。为实际改动的不变量复用或补充最小测试；未获浏览器授权时，不把静态检查和测试表述为真实运行性能或渲染验收。

## 跨层联动与闭环规则

1. 把“涉及”限定为当前任务确实要改动对应内容；不得因调用链经过、代码相邻或顺带发现扩大范围。
2. 实际改动一个业务域时，沿“入口与 schema → canonical owner → 存储、缓存或同步 → 运行态消费者与渲染 → 清理、恢复及测试”核对完整链路。列出受影响 owner 并同步修复；只有直接源码证明不受影响时才保持不动，不能以单点测试通过代替业务闭环。
3. 改动设置 schema、默认值、存储、重置或界面字段时，同步核对运行态热应用、设置导出与导入兼容、往返测试及 WebDAV `preferences`。始终排除 `translation.apiKey`、`webDav.username` 和 `webDav.password` 等凭据。
4. 改动缓存或其他持久数据的结构、读写、失效、清理、迁移或生命周期时，同步核对缓存管理入口、schema 兼容与账户隔离，以及对应 WebDAV 分类的捕获、序列化、三方合并、应用、删除、基线和失败恢复；保留兼容数据，只让实际读到的不兼容数据自愈。
5. 改动请求行为时，贯通请求描述与身份、profile 与缓存策略、统一 Gateway、Client、Scheduler、跨标签页许可、传输、重试与 429/Cloudflare 恢复、缓存失效和最终消费者；不得由页面 owner 绕开中央请求链或自行复制调度参数。
6. 改动 MessageBus 或实时刷新时，贯通事件标准化与合并、缓存失效、帖子或主题加载、`TopicSession` canonical 提交和 DOM 投影；不得只更新视图或只清缓存而留下状态分叉。
7. 改动帖子层级、DOM 高度、挂载、隐藏或布局时，同步核对投影与回复树、虚拟列表测量和滚动补偿、定位与高亮、已读可见性；保持几何与可见性单一 owner，避免重复测量和重复渲染。
8. 改动已读逻辑时，贯通候选预载、视口正面积资格、批处理、跨标签页单次提交、canonical 请求和仅服务端成功后的确认；缓存候选、失败请求或未返回项不得直接升级为已读。
9. 仅当改动后的能力应在离线页面成立时，同步核对离线文档生成、归档备份、缓存管理、WebDAV 离线主题和恢复测试；不把所有在线渲染改动无条件扩成离线改造。
10. 改动远端主机、API、鉴权或账户范围时，同步核对端点与凭据白名单、`authScope` 与缓存分区、用户脚本元数据及匿名边界；已有通配授权也不能代替安全检查。
11. 改动用户可见的设置、缓存、同步、重置或离线语义时，同步核对帮助文档、设置说明和功能目录；只更新真实受影响的文档契约。

## 工作流

### 1. 锁定范围

运行 `git status -sb`、`git diff --name-status`，再用 `rg` 读取真实 owner、相关测试和生成链。入口不明确或跨模块时调用 `semantic-code-search`。

### 2. 实现与验证

使用 `apply_patch` 做窄修改。修改 JS/TS/React 时只对本次文件运行一次 ESLint；运行最小相关测试。修复本次引入的问题后最多各重跑一次，不清理历史问题。源码单文件测试通过不代表 Greasy Fork 四文件产物语义一致；最终本地构建必须让本任务相关的源码测试与实际分包 runtime 测试各通过一次，并执行结构 parity gate。

### 3. 每次变更生成两套本地产物

任何影响 Lite 源码、样式、元数据或构建器的变更完成后，无条件运行：

```bash
npm run main-lite:local-debug
```

该命令必须一次生成并报告：

- 单文件快速调试：`work/main-lite.local.js`；
- 当前 CSS：`work/main-lite.css`；
- 四文件本地 Loader：`work/main-lite.greasyfork.local.user.js`；
- 四文件 Core：`work/greasyfork-lite/libraries/main-lite-core.js`；
- 四文件 Platform：`work/greasyfork-lite/libraries/main-lite-platform.js`；
- 四文件 Features：`work/greasyfork-lite/libraries/main-lite-features.js`。

该命令还必须通过内置的 `npm run main-lite:parity`：

- `npm run main-lite:test` 从事实源运行完整 Lite 契约；
- `npm run main-lite:greasyfork:test` 从实际生成的 Core、Platform、Features runtime 运行同一套契约；
- `scripts/verify-main-lite-local-parity.mjs` 核对两版的站点、权限、外部依赖、本地 CSS 指纹，逐项核对四文件中的全部 Lite 源码模块 SHA-256、manifest bytes/SHA-256 及 `main-lite`/`mian-lite` 兼容副本。

单文件 bundle 与分包 Library 的容器结构本就不同，不比较没有语义的整文件字节相等；上述契约与结构证据任一失败都不能写“功能无差异”。不能只测 `lite/src/`，也不能用构建成功或 Library 总哈希替代。

四文件 Loader 必须用 `file://` 引用上述本地 Core、Platform、Features 和 CSS，带“本地四文件测试”名称，并禁用自身更新；三个 Library 必须与 Greasy Fork 待发布产物是同一文件。构建输出必须给出四个 JS 文件和 CSS 的 bytes、SHA-256。

本任务边界内的构建、契约/parity gate 失败，或相关产物缺失、过期、引用远端项目 Library 时，保持任务未完成。汇总命令只命中已证明的边界外并行失败时，按固定边界排除，不修复或重跑；但本任务改动仍须进入相关生成物并通过可独立归因的检查。不要用手工复制或临时 Loader 绕过构建器。

### 4. 交付手动审查

说明两种入口：

- 快速功能审查启用 `work/main-lite.local.js`；
- 四文件结构审查安装 `work/main-lite.greasyfork.local.user.js`。

两版不可同时启用。报告修改文件、最小验证、两套构建结果和未做的浏览器验收；用户要求提交同步时再切换到 `$sync-lite-three-part-release`。
