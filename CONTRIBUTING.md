# 参与开发

感谢你改进 Awesome LinuxDo Reader。提交修改前，请先确认问题可以稳定复现，并将改动限制在当前需求内。

## 源码约定

- `work/main.js` 是唯一业务源码，不维护并行副本。
- 保持 userscript 元数据权限最小化。新增网络目标时检查 `@connect`，新增 GM API 时检查 `@grant`。
- 兼容 LINUX DO 的 SPA 导航和动态 DOM；监听器、Observer、计时器、Object URL 与缓存必须有明确的生命周期。
- 网络逻辑需要考虑超时、取消、并发、缓存、重试和 429 退避。
- 不在日志、Issue 或截图中提交 Cookie、Authorization、个人数据和完整响应正文。

## 本地调试

安装 [Rust 与 Cargo](https://rustup.rs/) 后，先执行项目自带的检查工具。首次运行会下载并编译锁定版本的 Rust 依赖，编译结果保存在系统临时目录：

```bash
./scripts/userscript-dev --json doctor
./scripts/userscript-dev --json inspect work/main.js
```

Windows PowerShell 使用 `.\scripts\userscript-dev.ps1`，参数与 Bash 入口相同。完整说明见 [`tools/userscript-dev/README.md`](tools/userscript-dev/README.md)。

需要在 Tampermonkey 中实时读取本地源码时，生成被仓库忽略的调试加载器：

```bash
./scripts/userscript-dev --json make-loader work/main.js --out work/local-debug.user.js
./scripts/userscript-dev --json verify-loader work/local-debug.user.js --source work/main.js
```

首次使用需在 Tampermonkey 中安装加载器，并开启“允许访问文件网址”。正式版和本地调试版不要同时启用。

## 验证

修改 JavaScript 后至少完成：

```bash
./scripts/userscript-dev --json inspect work/main.js
node --check work/main.js
npx --yes eslint@9.39.1 work/main.js
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
