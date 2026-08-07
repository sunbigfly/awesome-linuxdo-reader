# 参与开发

感谢你改进 Awesome LinuxDo Reader。提交修改前，请先确认问题可以稳定复现，并将改动限制在当前需求内。

## 源码约定

- `lite/src/` 是唯一业务源码，`lite/styles/` 是样式事实源；`work/mian-lite.css`、`work/greasyfork-lite/libraries/` 与 `work/mian-lite.js` 都由脚本生成，不直接编辑。
- `archive/legacy-main-2026-08-07/` 保存切换前的旧版 working copy；`work/main.js`、`work/main.css` 与 `work/greasyfork-split/` 只作旧版参考，不再作为 v1.0.0 发布入口。
- 保持 userscript 元数据权限最小化。新增网络目标时检查 `@connect`，新增 GM API 时检查 `@grant`。
- 兼容 LINUX DO 的 SPA 导航和动态 DOM；监听器、Observer、计时器、Object URL 与缓存必须有明确的生命周期。
- 网络逻辑需要考虑超时、取消、并发、缓存、重试和 429 退避。
- 不在日志、Issue 或截图中提交 Cookie、Authorization、个人数据和完整响应正文。

## 本地调试

安装 Node.js 20 或更高版本并执行 `npm install`。Lite 的日常验证与本地调试使用：

```bash
npm run mian-lite:check
npm run mian-lite:local-debug
```

`mian-lite:local-debug` 会生成被仓库忽略的 `work/mian-lite.local.js`，并同步生成 `work/mian-lite.css`。首次在 Tampermonkey 安装本地文件后，需要开启“允许访问文件网址”；正式版和本地调试版不要同时启用。

## 产物边界

| 产物 | 路径 | 版本控制 | 约束 |
| --- | --- | --- | --- |
| GitHub 原版 | `lite/src/`、`lite/styles/`、测试与构建脚本 | 提交 | 只在源码事实源中开发 |
| 本地测试版 | `work/mian-lite.local.js`、`work/local-debug.user.js`、`work/v1.0.0-acceptance.user.js` | 忽略 | 保留在本机，分别用于日常调试和带正式版本号的截图验收 |
| Greasy Fork 上传版 | `work/mian-lite.js`、`work/greasyfork-lite/libraries/`、`work/mian-lite.css` | 提交 | 确定性生成、可读、不压缩，发布前完成全部门禁 |

不要用正式上传版替代本地调试文件，也不要把本地绝对路径写入 GitHub 或 Greasy Fork。

## Greasy Fork Library 构建

从 TypeScript 源码生成两个可读、未压缩的 Greasy Fork Library 与主 Loader 模板：

```bash
npm run mian-lite:greasyfork:build
npm run mian-lite:greasyfork:check
```

构建把每个 TypeScript 模块转成保留路径与标识符的 CommonJS 工厂，按运行核心与功能域分配到两个 Library；不压缩、不混淆、不动态下载后执行。每个可执行产物必须低于 2,000,000 字节，`work/greasyfork-lite/build-manifest.json` 记录模块数、编译器版本、字节数与 SHA-256。

## GreasyFork 发布

1. 先提交并推送 `lite/`、`work/mian-lite.css` 和 `work/greasyfork-lite/libraries/`，以 GitHub 不可变提交作为 CSS 与 Library 同步来源。
2. 在 Greasy Fork 分别创建两个 Library，配置从对应 GitHub raw URL 同步，并取得各自带 `version` 参数的固定版本 URL。
3. 将 URL 写入被 Git 忽略的 `work/greasyfork-lite/release.config.json`，把 `lite/release-gate.json` 中的验收项与不可变 CSS URL更新为真实证据后运行 `npm run mian-lite:greasyfork:release`。
4. 核对 `work/mian-lite.js` 的元数据、Library 远端字节和 SHA-256，再更新现有脚本 588185；不得上传旧版压缩产物或未固定版本的 Library URL。

最终用户只安装脚本 588185。Core 和 Features Library 由主 Loader 的固定 `@require`
自动加载，不单独提供安装入口。Library 的 GitHub Raw 同步方式为 Webhook；GitHub
收到本仓库 `main` 推送后通知 Greasy Fork，平台再按每个 Library 的精确 Raw 路径同步。

## 验证

发布前至少完成：

```bash
npm run mian-lite:verify
npm run mian-lite:local-debug
npm run mian-lite:greasyfork:check
npm run docs:verify
```

交互、布局、视觉、性能和网络行为必须在真实浏览器中复现并检查。静态检查通过不等于浏览器验收通过。

## 提交内容

- 说明问题、改动范围和验证结果。
- UI 改动附修改前后截图；网络或性能改动附可复核的测量口径。
- 不提交 `work/local-debug.user.js`、临时截图、浏览器缓存或个人环境配置。
- 不顺带重构、改名或清理与当前问题无关的代码。

## 用户手册同步

用户可见入口、行为、设置、数据边界、权限或故障恢复发生变化时，文档属于同一项交付：

1. 更新 `docs/public/feature-catalog.json` 中对应功能的 `source_anchor`、`version`、`last_verified`、`screenshots` 和 `docs`。
2. 新功能创建稳定 `feature_id`；既有功能改名时保留编号。
3. 更新分类手册、完整设置参考和 `docs/reference/changelog.md`。
4. 每篇受影响页面同步更新 frontmatter 的 `feature_ids`、`source_anchors`、`version`、`last_verified` 和 `screenshots`。
5. 交互或视觉变化使用真实浏览器采集截图，并提供替代文本和说明；默认避开私信、凭据和敏感内容，维护者明确授权时可保留公开页面与公开账号信息。

文档验证：

```bash
npm install
npm run docs:check
npm run docs:build
```

`docs:check` 必须达到未文档化功能、缺失源码锚点、无效链接/图片和元数据错误均为 0。详细规范见 [`docs/reference/documentation.md`](docs/reference/documentation.md)。
