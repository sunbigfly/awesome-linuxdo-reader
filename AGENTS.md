# Awesome LinuxDo Reader 项目规则

## 默认开发入口

- 本仓库当前默认开发对象是 Lite 阅读器。涉及 Lite、`main-lite`、WebDAV、设置、阅读器界面或交互时，使用 `$develop-lite-reader`。
- Lite 已验证变更需要提交、推送或同步 GitHub、Greasy Fork 四文件版和用户手册时，使用 `$sync-lite-three-part-release`（保留该 Skill 名称作兼容入口）。
- 只有明确维护旧版 `work/main.js` 单文件脚本时，才使用 `$tampermonkey-dev-assistant`；不要把旧版流程用于 Lite。

## Lite 事实源与生成物

- 业务事实源：`lite/src/`。
- 样式事实源：`lite/styles/`。
- userscript 元数据事实源：`lite/userscript.meta.txt`。
- `work/main.js` 和 `work/main.css` 仅作旧版兼容参考，不是 Lite 的修改入口。
- 不直接编辑 `work/main-lite*.js`、`work/mian-lite*.js`、`work/main-lite.css`、`work/mian-lite.css` 或 `work/greasyfork-lite/libraries/*.js`；统一通过构建器生成。
- canonical 名称统一使用 `main-lite`；保留 `mian-lite` 生成物和 npm 命令作为兼容别名，但不把它们作为主要入口。

## Lite 开发路径

1. 先运行 `git status -sb` 和 `git diff --name-status`，保留用户已有 dirty 文件，只处理当前需求。
2. 从事实源和直接调用点定位 owner，使用 `apply_patch` 做窄修改，不顺手重构旧版或无关模块。
3. 修改 JS、TS 或 React 时，只对本次改动文件运行一次 ESLint；修复本次引入的问题后最多再运行一次。运行与改动直接相关的最小测试。
4. 任何影响 Lite 源码、样式、元数据或构建器的变更完成后，必须运行：

   ```bash
   npm run main-lite:local-debug
   ```

5. 该命令必须同时生成：
   - `work/main-lite.local.js`；
   - `work/main-lite.css`；
   - `work/main-lite.greasyfork.local.user.js`；
   - `work/greasyfork-lite/libraries/main-lite-core.js`；
   - `work/greasyfork-lite/libraries/main-lite-platform.js`；
   - `work/greasyfork-lite/libraries/main-lite-features.js`。
6. 构建失败、产物缺失或四文件本地 Loader 引用远端项目 Library 时，任务保持未完成。

## 手动审查与证据边界

- 快速功能审查启用 `work/main-lite.local.js`。
- Greasy Fork 四文件结构审查安装 `work/main-lite.greasyfork.local.user.js`；它应通过 `file://` 加载本地 Core、Platform、Features 和 CSS，并禁用自身更新。
- 两个本地测试版不可同时启用。
- 构建、静态检查和测试不等于真实浏览器验收。只有用户在当前请求中明确要求浏览器、DevTools、真实页面或自动化验收时才调用浏览器工具。
- 报告时分别说明源码检查、测试、构建、浏览器验收、远端同步和用户手动审查，不混写为同一种证据。

## 提交与三块同步

- “提交/同步”表示功能验证已经完成；同步阶段只做版本、生成物、固定 URL、bytes、SHA-256、兼容别名、GitHub、Greasy Fork 和用户手册的一致性检查，不重复浏览器矩阵或性能门禁。
- 本地调试 Loader、本机路径、凭据、Cookie、Token 和发布私有配置不得进入提交。
- 未经当前请求明确授权，不 commit、push、修改 Greasy Fork 或执行其他外部写入。
- 发布时使用 `work/main-lite.js` 薄 Loader、Core、Platform、Features 四文件结构；CSS 作为固定 Git 提交和 SHA-256 的 `@resource`，不是第五个 Greasy Fork 可执行文件。
- 远端 Library 或 CSS 坐标变化时，先取得不可变坐标，再由同一个 `scripts/build-main-lite-greasyfork.mjs` 生成并复核最终 Loader。

## 详细流程

- Lite 开发与本地审查：`.agents/skills/develop-lite-reader/SKILL.md`。
- Lite 提交与三块同步：`.agents/skills/sync-lite-three-part-release/SKILL.md`。
- 旧版单文件脚本：`.agents/skills/tampermonkey-dev-assistant/SKILL.md`。

当本文件与生成说明冲突时，以当前事实源、构建脚本和实际命令结果为准；不要依据历史对话猜测当前状态。
