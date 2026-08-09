---
name: develop-lite-reader
description: "在当前 awesome-linuxdo-reader 仓库开发、修改、修复或审查 Lite 阅读器。用户提到 Lite 功能、lite/src、lite/styles、main-lite、本地调试版、Greasy Fork 三文件本地测试版，或要求变更后生成可手动审查产物时使用；每次 Lite 变更都生成单文件本地调试 JS 和 Loader + Core + Features 三文件本地测试版。不用于提交、push 或线上发布。"
---

# 开发 Lite 阅读器

只处理 Lite 开发与本地审查产物。提交和线上同步交给 `$sync-lite-three-part-release`；旧版 `work/main.js` 交给 `$tampermonkey-dev-assistant`。

## 固定边界

1. 把 `lite/src/`、`lite/styles/` 和 `lite/userscript.meta.txt` 作为事实源；只把 `work/main.js`、`work/main.css` 当作只读对照。
2. 不直接编辑 `work/main-lite*.js`、`work/mian-lite*.js`、`work/main-lite.css`、`work/mian-lite.css` 或 `work/greasyfork-lite/libraries/*.js`。
3. 记录并保留任务前 dirty 路径，只改当前需求的 owner、测试和必要构建配置。
4. 不自动改版本、提交、push、发布或修改 Greasy Fork 设置。
5. 浏览器、DevTools、真实页面和截图仅在当前请求明确授权时使用；本地构建不等于浏览器验收。

## 工作流

### 1. 锁定范围

运行 `git status -sb`、`git diff --name-status`，再用 `rg` 读取真实 owner、相关测试和生成链。入口不明确或跨模块时调用 `semantic-code-search`。

### 2. 实现与验证

使用 `apply_patch` 做窄修改。修改 JS/TS/React 时只对本次文件运行一次 ESLint；运行最小相关测试。修复本次引入的问题后最多各重跑一次，不清理历史问题。源码单文件测试通过不代表 Greasy Fork 三文件产物语义一致，构建器变更必须由分包产物重新执行同一套契约测试。

### 3. 每次变更生成两套本地产物

任何影响 Lite 源码、样式、元数据或构建器的变更完成后，无条件运行：

```bash
npm run main-lite:local-debug
```

该命令必须一次生成并报告：

- 单文件快速调试：`work/main-lite.local.js`；
- 当前 CSS：`work/main-lite.css`；
- 三文件本地 Loader：`work/main-lite.greasyfork.local.user.js`；
- 三文件 Core：`work/greasyfork-lite/libraries/main-lite-core.js`；
- 三文件 Features：`work/greasyfork-lite/libraries/main-lite-features.js`。

该命令还必须通过 `npm run main-lite:greasyfork:test`：从实际生成的 Core、Features 注册模块中运行完整 Lite 契约测试，不能改为只测 `lite/src/`，也不能用 bytes、SHA-256 或构建成功替代。

三文件 Loader 必须用 `file://` 引用上述本地 Core、Features 和 CSS，带“本地三文件测试”名称，并禁用自身更新；Core/Features 必须与 Greasy Fork 待发布产物是同一文件。构建输出必须给出三个 JS 文件和 CSS 的 bytes、SHA-256。

构建失败、分包契约测试失败，或任一产物缺失、过期、引用远端项目 Library 时，保持任务未完成。不要用手工复制或临时 Loader 绕过构建器。

### 4. 交付手动审查

说明两种入口：

- 快速功能审查启用 `work/main-lite.local.js`；
- 三文件结构审查安装 `work/main-lite.greasyfork.local.user.js`。

两版不可同时启用。报告修改文件、最小验证、两套构建结果和未做的浏览器验收；用户要求提交同步时再切换到 `$sync-lite-three-part-release`。
