---
name: tampermonkey-dev-assistant
description: "仅维护当前 awesome-linuxdo-reader 仓库旧版单文件 userscript。用户明确提到 work/main.js、旧版、Legacy、单文件版、本地 @require 调试旧版，或要求对旧版 Tampermonkey 脚本做浏览器、请求、性能和内存诊断时使用；Lite、main-lite、lite/src 与 Greasy Fork 四文件开发改用 develop-lite-reader，Lite 提交发布改用 sync-lite-three-part-release。"
---

# Legacy Tampermonkey 全程开发助手

仅在当前仓库旧版路径使用。把 `work/main.js` 作为旧版唯一业务源码；请求涉及 `lite/` 或 `main-lite` 时停止并改用 `$develop-lite-reader`。辅助 CLI 必须使用 Rust，不得引入或调用 Python。

## 工作契约

1. 先判定请求类型：回答/解释/审查/诊断只读；开发/修改/修复才编辑；发布、提交、外部写入、破坏性操作或扩大范围需获得对应授权。
2. 读取适用的 `AGENTS.md`、当前 git 状态、userscript 元数据和相关调用点。当前文件与运行结果优先于历史说明。
3. 用一句话确定目标、硬约束、成功标准和不在范围内的事项。仅在会实质改变结果时提问。
4. 项目有并行任务时，检查和生成只按当前任务的 exact paths、`work/main.js` 相关调用点、测试和本地 Loader 归因。边界外的 dirty、失败和生成物变化不分析、不修复、不回滚、不重跑、不等待，也不作为本任务阻塞；只有路径重叠、结果无法独立验证或未授权内容会进入交付时才停止。
5. 每条约束只保留一处。只调用当前阶段需要的工具；不要为了“全能”一次暴露或调用全部工具。
6. 先完成安全、可逆、范围内的工作；遇到审批边界时给出 exact target、动作、收益和风险后停止。

## 工具路由

- 已知路径、符号或文本先用 `rg` 和源码阅读；入口不明确或跨模块时调用 `semantic-code-search`。
- 编辑文件只用 `apply_patch`；保留用户改动，不顺手重构或清理。默认只改 `work/main.js`；Skill 自身任务才可改 `.agents/skills/tampermonkey-dev-assistant/`。
- JS/TS/React 只对本次改动文件按仓库规则运行一次 ESLint；修复本次引入问题后最多再运行一次。语法检查不能替代浏览器验收。
- 只有当前请求明确授权浏览器、DevTools 或真实页面验收时，才在 fresh session 使用项目专用 `chrome-devtools-full`；工具权限不扩大发布、付费、敏感数据和仓库外写入授权。
- 浏览器 MCP 或所需工具不在 fresh session 的 live tool surface 时，报告未自动验收并给出最短手动步骤；不要用 Puppeteer、Playwright、Selenium 或临时浏览器脚本冒充验收。
- 需要当前 Tampermonkey、Chrome 或第三方 API 资料时，用适用的官方文档/检索 Skill，获取正文后再下结论。
- 用户要求 commit/push 时调用 `commit-workflow`；没有明确要求时不提交、不推送、不发布。

## 全流程

### 1. 发现与基线

1. 读取 `work/main.js` 的 userscript 元数据和当前 git 状态。
2. 先运行离线诊断，再检查源码：

   ```bash
   .agents/skills/tampermonkey-dev-assistant/scripts/userscript-dev --json doctor
   .agents/skills/tampermonkey-dev-assistant/scripts/userscript-dev --json inspect work/main.js
   ```

3. 核对 `@match/@include`、`@grant`、`@connect`、`@run-at`、外部 `@require`、版本、更新地址和文件哈希。CLI 给出的请求行号是静态候选调用点，必须用浏览器 Network/Initiator 复核归因。
4. 检查页面运行位置、沙箱边界、宿主 API、存储、网络入口、事件监听、Observer、定时器和清理路径。
5. 对 UI 或性能任务记录修改前基线；对 LINUX DO 默认监控完整宿主页面，不只监控 userscript。

### 2. 设计与实现

1. 将需求映射到最小调用点和可观察成功标准。
2. 保持元数据权限最小化；新增跨域请求时同步审查 `@connect`，新增 GM API 时同步审查 `@grant`。
3. 处理 SPA、动态 DOM、重复初始化、页面切换和销毁；保证监听器、Observer、定时器、Object URL 和缓存有界且可释放。
4. 网络代码必须定义超时、取消、并发、缓存、重试和 429 行为；不得记录 Cookie、Authorization、完整响应正文或个人数据。
5. 使用 `apply_patch` 做窄修改。不要自动改版本号、更新地址、发布目标或无关格式。

### 3. 静态验证

1. 重新运行 `inspect` 并比较元数据、哈希和请求入口。
2. 运行仓库已有的最小相关测试/检查；遵守适用 `AGENTS.md` 的 ESLint 次数限制。
3. 检查未定义变量、早期 `document-start` 时序、沙箱与 `unsafeWindow` 边界、重复注入、异常吞没和敏感日志。
4. 静态检查失败时只修复本次引入的问题；边界外并行任务或历史问题按工作契约排除。

### 4. 本地实时加载

Tampermonkey 编辑器只保存稳定调试加载器，实际业务代码通过最后一个本地 `@require` 加载。保存源码后刷新页面即可读取新文件；不要尝试在已运行页面热替换 IIFE、监听器或 Observer。

生成加载器（默认写入被仓库忽略的 `work/local-debug.user.js`）：

```bash
.agents/skills/tampermonkey-dev-assistant/scripts/userscript-dev --json make-loader work/main.js --out work/local-debug.user.js
```

核验加载器：

```bash
.agents/skills/tampermonkey-dev-assistant/scripts/userscript-dev --json verify-loader work/local-debug.user.js --source work/main.js
```

脚本默认拒绝覆盖已有文件；只有用户明确允许覆盖时才传 `--force`。首次仍需用户在 Tampermonkey 中安装加载器并启用“允许访问文件网址”。正式版与本地调试版不可同时启用。

辅助 CLI 仅依赖本机 Rust/Cargo，使用锁文件离线运行，不调用 Python。标准输出始终是单个 JSON 对象：`ok`、`command`、`data` 或 `error`；退出码 `0` 表示通过，`2` 表示命令或校验失败。不要从自然语言日志推断成功。

### 5. 真实浏览器调试

1. 确认 fresh session 已加载 `chrome-devtools-full`，Windows CloakBrowser、调试端点和目标 `linux.do` 页面可用。
2. 在刷新前开始必要的 Console/Network/Performance 记录；`@run-at document-start` 问题必须从刷新前捕获。
3. 刷新页面，验证调试脚本仅运行一次，并检查版本/哈希对应的调试标记或可观察行为。
4. 直接复现用户动作；记录结果、错误、请求、资源趋势和截图。只有工具实际不可用或站点要求人工完成验证时才让用户接手最短步骤。
5. 不能看到真实页面、截图或交互结果时，不得声称视觉验收通过。

详细流程见 [runtime-observability.md](references/runtime-observability.md)。

### 6. 宿主与 userscript 双层观测

默认运行同场景 A/B：

- A：关闭本地调试脚本，记录纯宿主页面。
- B：开启本地调试脚本，重复相同步骤和缓存条件。
- 比较增量，并按 `host`、`userscript-fetch`、`tampermonkey-gm`、`external-resource` 分类。

至少检查请求总数、失败/取消/429、缓存、传输量、排队和并发；检查 CPU、长任务、JS Heap、DOM Nodes、Event Listeners、Layout/Style，以及操作结束后未释放的 Detached DOM。固定阈值不是泄漏证据；关注重复操作与 GC 后是否持续单调增长。

### 7. 迭代与停止

1. 将失败定位到最小调用点，修复后只重跑相关静态检查和同一浏览器场景。
2. 不重复已经成功且不受改动影响的取证。
3. 满足源码、静态、运行态和宿主回归证据后停止；需要用户主观判断时询问：“这是你要的效果吗？有没有要调的？”

### 8. 发布与交付

发布前读取 [release-and-security.md](references/release-and-security.md)。只有用户明确要求发布时才更新版本、构建发布文件或写入 GreasyFork。交付时先给结论，再列修改文件、验证证据、未验收项、风险和下一动作；区分静态检查、自动浏览器取证和用户手动验收。

## 工具编排约束

- 并行执行互不依赖的只读搜索；依赖上一步判断、涉及写入或审批的动作保持顺序。
- 对批量读取/归类使用程序化编排时，只处理无副作用且输出结构稳定的步骤；输出必须保留文件、行号、分类和异常。
- 每个阶段最多对瞬时失败重试两次；权限、配置、业务错误和重复相同失败不盲重试。
- 工具成功不等于任务成功：最终必须检查用户目标、必需证据、宿主回归、敏感数据边界和未完成事项。

## 调用示例

```text
$tampermonkey-dev-assistant 修复 work/main.js 的楼中楼加载并完成浏览器闭环验收
$tampermonkey-dev-assistant 监控 linux.do 宿主与脚本请求、CPU 和内存泄漏
$tampermonkey-dev-assistant 为当前 userscript 建立本地 @require 调试加载器
$tampermonkey-dev-assistant 审查这个油猴脚本的权限、跨域请求和发布风险
```
