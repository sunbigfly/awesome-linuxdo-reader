---
name: sync-lite-three-part-release
description: "在当前 awesome-linuxdo-reader 仓库完成一次已验证 Lite 变更的三块一致性同步：GitHub 源码与版本说明、Greasy Fork 薄 Loader + Core + Platform + Features 四文件链及公开介绍页、当前版本用户手册与 GitHub Pages。用户说‘同步三大块’‘发布 Lite’‘更新 Greasy Fork 四文件版’‘提交并同步 Lite 发布’‘补齐线上发布坐标’‘发布网络恢复后继续’‘检查三块是否对齐’或‘完成发布对齐’时使用；Skill 名称保留 three-part 作为兼容入口，仅适用于本仓库，同一产物快照复用开发阶段门禁，不重复功能、浏览器或性能验收。"
---

# 同步 Lite 三大发布块

把一次 Lite 变更同步到三个发布面，同时保留 Greasy Fork 四文件架构的固定版本、哈希和回滚证据。只更新实际变化的 Library，不因一次局部变更盲目重传全部产物；同一字节快照的重型门禁只执行一次。

## 固定边界

1. 先确认仓库根目录同时包含 `package.json`、`lite/`、`work/greasyfork-lite/` 和 `scripts/build-main-lite-greasyfork.mjs`；否则停止，说明本 Skill 不适用。
2. 读取仓库当前 `AGENTS.md`（如有）、`package.json`、Lite 构建器和发布坐标；不要加载旧版 `work/main.js` 开发 Skill。
3. 把“三大块”固定为：
   - GitHub：业务源码、确定性产物、版本/发布说明；
   - Greasy Fork：薄 Loader、Core Library、Platform Library、Features Library，以及主脚本公开介绍页；
   - 用户手册：`docs/`、截图、变更记录和 GitHub Pages。
4. 把 CSS 视为 `work/main-lite.css` 固定哈希 `@resource`，不是第五个 Greasy Fork 可执行单元。
5. 把 `lite/src/`、`lite/styles/` 和 `lite/userscript.meta.txt` 视为事实源；不要直接手改 `work/main-lite.js`、`work/main-lite.css` 或 `work/greasyfork-lite/libraries/*.js`。
6. 记录并保留任务开始前的 dirty 路径；只暂存本次批次的路径白名单。默认排除用户的 `work/main.js`、`work/main.css`、`work/main-lite.local.js`、`work/main-lite.greasyfork.local.user.js`、日志和其他既有改动。
7. 项目有并行任务时，检查和生成只按本次发布批次的 exact path 白名单、影响产物和待发布字节归因。白名单外的 dirty、失败和生成物变化不分析、不修复、不回滚、不重跑、不等待；只有它进入本批白名单、改变本批待发布字节或使发布证据无法独立成立时，才作为本任务边界冲突停止。
8. 永不提交 `work/greasyfork-lite/release.config.json`、凭据、Cookie、Token、本机路径或被忽略的验收副本。
9. 只有用户确认发布批次后才执行 push、Greasy Fork 设置修改和立即同步；只要求准备时停在本地验证结果。
10. 1.0.1 迁移期必须保留 `mian-lite:*` 命令和同名生成物兼容别名；canonical 与旧拼写的 Loader、CSS、Core、Platform、Features 必须由同一次构建生成且逐字节一致。所有新文档、GitHub Raw URL 与 Greasy Fork 同步源使用 `main-lite`。
11. 把“提交/同步”视为功能验证已经完成。本 Skill 不重复 ESLint、源码/分包契约、浏览器矩阵、性能门禁或主观界面验收；单文件与实际 Core、Platform、Features 的 parity gate 必须有当前快照的成功收据，但同一快照不得重复执行。
12. 开发阶段必须已经运行 `npm run main-lite:local-debug`，生成单文件和四文件本地审查版；该命令已包含源码与分包 runtime 契约、元数据/CSS/源码模块/manifest/兼容副本 parity gate。本 Skill 记录并复用其当前快照收据，不重新生成开发调试产物，只在取得不可变发布坐标后生成并复核最终 Loader。
13. Greasy Fork 主脚本公开介绍页不是 GitHub README，GitHub Webhook 只同步代码，不会自动更新该正文。介绍页更新是独立外部写入，必须列入审批包；发布完成前必须从公开页面回读目标版本与最终坐标，不能用代码更新时间代替。
14. 用户明确延期 Greasy Fork 时，把它视为部分发布，而不是“本轮不打开 Greasy Fork”。先用 GitHub API 脱敏核对活动的 `greasyfork.org` push Webhook；审批包必须明确采用以下一种边界：暂不推送受 Hook 管理的 Loader/Library，或经用户批准暂挂相关 Hook 并保持关闭直到后续 Greasy Fork 发布。不得先 push 再赌 Webhook 不触发，也不得把 GitHub/Pages/CSS 已同步写成“三块已对齐”。

## 先判定影响面

不要按目录名猜测最终发布单元。完成构建后以生成文件的字节数和 SHA-256 变化为准。

| 变更 | 必查产物 | 发布动作 |
| --- | --- | --- |
| `lite/src/**` | Core、Platform、Features、Loader | 只同步哈希变化的 Library；最终重建 Loader |
| `lite/styles/**` | `work/main-lite.css`、Loader | 先推送 CSS，再把 `readerStylesUrl` 固定到包含该 CSS 的 Git 提交 |
| userscript 元数据或构建器 | 三个 Library、Loader | 依 manifest 判定 Library；重建 Loader |
| `docs/**`、截图、说明 | 用户手册 | 不因纯文档变更生成 Greasy Fork 新版本 |
| Greasy Fork 公开介绍 | 主脚本介绍正文 | 取得最终 Loader/Core/Platform/Features ID 后只更新一次并公开回读 |
| 发布坐标或状态记录 | Loader | 先核验远端 Library，再生成 Loader |

读取当前坐标与证据时，以这些文件为准：

- `work/greasyfork-lite/published-libraries.json`
- `work/greasyfork-lite/build-manifest.json`
- `lite/release-gate.json`
- `work/greasyfork-lite/README.md`
- Greasy Fork 主脚本公开页正文（只作线上回读证据，不是 GitHub README 的替代事实源）

## 快路径与耗时预算

先保留不可压缩的因果链，再消除等待和重复写入：

- GitHub 读取固定优先级为：`gh api` → 其他 `gh` 子命令 → GitHub Raw/普通 HTTP → 带短超时的 `git ls-remote` → 浏览器。分支 SHA、提交、Actions、Pages 和必要时的 Hook 状态都先用 `gh api`；大文件逐字节校验仍使用 Raw，push 仍使用 Git。
- 只有 Library 或 CSS 变化时才需要 A；只有 Loader 内容变化时才需要 B；只有线上固定 ID 或公开证据需要入库时才需要 C。跳过空批次，纯文档保持单次提交。
- Library/CSS 与 Loader 都变化时，A → 远端固定坐标 → B 是安全下限，不能并成一次 push；C 只记录最终线上证据，不夹带可执行文件。
- 不在 B 写“发布中”“待 Webhook”之类临时 README、安装说明或手册文案；B 只提交发布配置和最终 Loader，取得主 Loader ID 后在 C 一次写成最终状态。
- 本地发布检查尽量合并到一个 shell 调用；远端 API、Raw 和固定文件读取按阶段各批量查询一次。不展示完整生成文件 diff。
- 为 parity gate 记录“快照收据”：目标版本、Core SHA-256、Platform SHA-256、Features SHA-256、CSS SHA-256、单文件 SHA-256、构建器、源码/分包契约脚本与 `verify-main-lite-local-parity.mjs` 的 Git blob ID，以及成功的 `npm run main-lite:local-debug` 命令。当前发布会话内这些值完全相同就复用收据；任一值变化、收据缺失或上次执行中断时才重新生成并验证一次，不要为了“更保险”在发布前后重复执行。
- 最终坐标构建正常路径只运行一次写入构建，再做 `cmp`、元数据和 SHA-256 常量时间核对；只有构建器或事实源在收据后变化、写入被中断、产物哈希变化或核对失败时，才补一次 `--check` 或分包契约测试。
- 已配置的 Greasy Fork Webhook 默认视为可靠触发器，不例行打开管理页、查询 GitHub delivery 或深挖源码页面。记录 push UTC 时间后，用 WebSearch/官方公开 API 查看目标版本的 `created_at` 或分发端 `Last-Modified` 已更新即可确认触发；只有更新时间在轮询窗口内未变化时才排查 Webhook。
- 公开版本轮询前 30 秒使用 2 秒间隔，之后使用 5 秒间隔，总计最多 60 秒，发现目标版本立即停止；Pages 只等待最终 C 对应的一次工作流。
- 浏览器不是远端坐标的默认读取路径。优先使用 GitHub API、Greasy Fork API 和 `update.greasyfork.org`；只有 API 与公开分发端都不可用，或确需修改同步设置时才进入浏览器。

## 并行子代理编排（不改变 A/B/C 语义）

可以用 subagent 并行独立的只读准备和核验，以减少正常路径等待；每次启动子代理都必须显式指定 `model: gpt-5.6-luna`、`reasoning: max`（或工具对应的 `reasoning_effort: max`），不得依赖默认模型/推理级别，也不得用其他模型替代。子代理共享当前工作树，主代理先记录 dirty 基线并负责路径锁和冲突协调。

- 主代理独占文件写入冲突协调、`git add`、`git commit`、`git push`，以及 Greasy Fork 管理页的任何写入；这些动作即使子代理具备凭据也不能委托。
- 子代理默认只读：可读源码、manifest、GitHub API/Raw、Greasy Fork 公开 API/分发文件并返回证据，但不能修改共享生成物、发布配置或状态文件。确需写文件时，主代理必须先分配 exact path 白名单；各子代理的白名单不得重叠，且子代理不得在该白名单之外改名、删除、暂存或写入。没有明确白名单时只返回补丁建议，不落盘。
- 子代理不得执行 `checkout`、`reset`、`rebase`、`merge`、`git add/commit/push` 或 Greasy Fork 管理写入；读操作的结果必须带路径/URL、UTC 时间、版本或提交、bytes、SHA-256/规范化规则和失败原因，不打印凭据。

正常路径可按以下三组并行准备，主代理在依赖屏障处汇合结果：

| 子代理 | 可并行时机 | 只读职责与交付物 |
| --- | --- | --- |
| 手册一致性/待更新字段审计 | A 前；B 后可再读一次最终坐标 | 审核 README、`docs/`、变更记录、安装链接、版本和待回填字段；返回 exact path、旧值、目标值和是否需要 C，不直接改跨文件手册。 |
| GitHub/Greasy Fork 远端核验 | A 前查基线；A 后查变化的 Library/CSS；B 后查主 Loader | 批量读取分支/提交、三个 Library 的 `version ID`、`created_at`、固定 Raw/分发文件 bytes 和 SHA-256，并在 B 后计算 Loader 原始与去平台元数据后的规范化 SHA-256；不打开管理页。 |
| 发布证据整理 | 与上述只读任务同批；A/B 后接收新坐标继续整理 | 将快照收据、manifest、固定 URL、版本 ID、bytes、哈希、时间和 Pages/公开页结果整理成主代理可审阅的 C 证据清单；默认不写证据文件。 |

若需要多次远端查询，子代理应在同一阶段批量发起独立请求；主代理只等待该阶段所需结果，不重复已通过的契约门。子代理可提前准备下一阶段的检查命令或证据模板，但不能把准备结果当作批准、提交或发布结果。

以下不可并行的因果链是硬屏障，子代理只能在屏障前准备输入、在屏障后做独立只读核验，不能跨屏障写入：

```text
A push → Library version IDs/bytes/SHA-256 → published config/CSS immutable commit
→ 最终 Loader build → B push → Loader version ID/raw+normalized SHA-256 → C
```

其中，A/B/C 仍分别遵守后文的审批包、白名单、普通 push、实时远端 SHA 和恢复点规则：只有 A push 成功并取得 Library/CSS 不可变证据后，主代理才能更新 `published-libraries.json`/CSS 坐标并生成最终 Loader；只有最终 Loader 构建核对通过后，主代理才能执行 B push；只有 B 后取得主 Loader version ID 及原始/规范化哈希，才能由主代理写入并推送 C 的手册/发布证据。任何子代理都不能缩短、重排或合并这条链。

## 授权、批次与恢复点

开始时只声明一次目标版本、变更范围、排除项、一致性证据和完成条件。安全的本地读取与只读检查可直接执行；提交、push、Greasy Fork 写入或其他外部写入必须先展示以下审批包并等待一次明确确认：

- 各提交批次的 exact paths 与目的；
- 外部目标，如 `origin/<branch>`、Greasy Fork Loader/Core/Platform/Features 脚本和主脚本公开介绍页；
- 保留不动的 dirty 路径；
- 收益、主要风险和回滚点。

一次确认只覆盖审批包中同一版本、路径、目标和下列预期批次；目标或范围实质变化时重新确认，不为已批准批次中的正常阶段重复询问。

| 批次 | 内容 | 何时需要 |
| --- | --- | --- |
| A：远端基线 | 事实源、变化的 Library/manifest、CSS、必要说明 | 必须先取得不可变 Git/Library 坐标时 |
| B：正式发布 | 发布配置、Library/CSS 坐标和最终 Loader | 发布主 Loader 前 |
| C：线上证据 | 公开 version ID、远端 bytes/SHA-256、Greasy Fork 介绍页最终正文和 Pages 状态 | 主 Loader ID 成立，且线上核验后确有证据或介绍页变化时 |

跳过空批次；没有不可变坐标依赖时合并 A、B。纯文档变更只提交并同步文档，不构建或重发 Greasy Fork。批次 C 不得夹带可执行产物变化，也不得因此主动重发 Greasy Fork。

本批 exact path 出现意外 dirty 重叠、疑似秘密、一致性失败、非 fast-forward 拒绝或远端字节不一致时停止；边界外变化按固定边界排除。瞬时网络失败则记录 `branch`、`HEAD`、dirty 基线、已完成检查和唯一待执行命令。恢复时先确认本批状态未变并查询实时远端 SHA：远端已经等于目标 `HEAD` 就直接收口，否则只重试失败的外部动作与远端核验，不重复提交或发布。工作树没有本批新变更而分支仅为 ahead 时，审核 ahead commit 后直接续推，不创建空提交。

## 1. 锁定待同步快照

先运行：

```bash
git status -sb
git branch --show-current
git log -1 --oneline --decorate
git diff --name-status
git diff --stat
```

记录任务前 dirty 路径和待同步 commit。此阶段不修改事实源、不重建产物、不补功能验证；只有本批白名单或待发布字节仍在变化时才停止并返回开发/验证阶段，边界外并行变化不等待。

## 2. 只检查发布一致性

按影响面只检查有关的一致性项：

- 版本：`package.json`、userscript 元数据、Loader、README、安装说明和变更记录使用同一目标版本；
- 产物：`build-manifest.json` 的模块数、bytes 和 SHA-256 与现有 Core、Platform、Features、Loader 文件一致，且每个可执行文件不超过 `2 MiB`；
- 坐标：Loader 的三条项目 Library `@require` 与 `published-libraries.json` 的固定 version URL、bytes 和 SHA-256 一致；
- CSS：`readerStylesUrl` 指向已包含目标 CSS 的不可变 Git commit，声明哈希与 `work/main-lite.css` 一致；
- 兼容别名：现存 canonical `main-lite` 与 `mian-lite` 生成物逐字节一致；
- 本地审查：`work/main-lite.local.js` 与 `work/main-lite.greasyfork.local.user.js` 存在，四文件 Loader 只用 `file://` 引用本地 Core、Platform、Features 和 CSS；
- 本地 parity：同一快照的源码与分包 runtime 契约均通过，元数据、CSS、全部 Lite 源码模块哈希、manifest 和兼容副本均通过 `verify-main-lite-local-parity.mjs`；不要求架构不同的 JS 容器整文件字节相等；
- 手册：版本、安装链接、固定发布坐标和“已发布/准备中”状态不冲突。

此时只检查事实源对应的 Library、模板、manifest 与兼容别名，不提前校验尚未取得的新 CSS/Library 远端坐标。先从开发阶段 `main-lite:local-debug` 的成功输出记录快照收据；若当前会话没有收据，或当前哈希/blob ID 与收据不同，仅运行一次完整本地构建：

```bash
npm run main-lite:local-debug
```

随后无论是否复用收据，都只做低成本字节与哈希核对：

```bash
cmp work/greasyfork-lite/libraries/main-lite-core.js \
  work/greasyfork-lite/libraries/mian-lite-core.js
cmp work/greasyfork-lite/libraries/main-lite-platform.js \
  work/greasyfork-lite/libraries/mian-lite-platform.js
cmp work/greasyfork-lite/libraries/main-lite-features.js \
  work/greasyfork-lite/libraries/mian-lite-features.js
sha256sum work/main-lite.js \
  work/greasyfork-lite/libraries/main-lite-core.js \
  work/greasyfork-lite/libraries/main-lite-platform.js \
  work/greasyfork-lite/libraries/main-lite-features.js \
  work/main-lite.css
```

`main-lite:local-debug` 内置 `main-lite:parity`，源码与实际 Core、Platform、Features runtime 分别运行完整 Lite 契约，并执行结构 parity gate。本批白名单或待发布字节相关的失败时停止发布，不能以其中一侧测试、总哈希一致或人工检查替代；只命中已证明的边界外并行失败时按固定边界排除。快照相同只复用已通过的收据，不再次运行这些命令。

用 `git diff -- work/greasyfork-lite/libraries/ work/greasyfork-lite/build-manifest.json` 判断哪一个 Library 变化。若三库都没变化，不创建新的 Library 版本。

## 3. 建立远端基线并证明同步

当 Library 或 CSS 变化时执行批次 A。固定版本 URL 尚未取得时，不把引用旧远端哈希的最终 `work/main-lite.js` 混入该批次。

调用 `commit-workflow` 处理提交范围、敏感信息和 Git 安全，但不重复开发阶段已经完成的 ESLint、测试、构建或浏览器验收。增加以下本仓库一致性约束：

1. 从影响面表生成 exact path 白名单；用 `git diff -- <paths>` 审核内容，并对新增行做高置信敏感信息扫描，命中时只报告脱敏位置。
2. 运行 `git diff --check -- <paths>`，再用 `git add <paths>` 显式暂存；检查 `git diff --cached --name-status`、`git diff --cached --stat` 和 `git diff --cached --check`。
   - dirty 重叠文件只在所属批次执行一次交互式部分暂存；其他白名单路径一次暂存完成。
   - 生成物已经由 bytes/SHA-256 和构建器证明后，不再输出其完整 diff。
3. 提交信息使用具体中文主题和 2–5 条正文，说明发布单元、用户可见效果与验证；不混入基线 dirty 路径。
4. 获得发布批次确认后执行普通 `git push origin <branch>`；不得自动 pull、rebase、merge、amend、设置 upstream 或 force push。网络路径按以下顺序只尝试必要分支：
   - 先用 `gh api` 读取目标分支 SHA，兼作 GitHub 连通性与当前身份可用性检查。
   - `gh api` 成功且 origin 是 SSH URL 时，优先直接使用下述一次性 HTTPS URL rewrite 与 `gh auth git-credential` 执行同一个 `push origin <branch>`，不先等待 SSH 失败；不得打印 token、修改 remote 或写持久 Git 配置。
   - `gh api` 不可用时才使用 SSH origin；加短超时且只尝试一次，不在 443 失败后再试 22 端口或反复握手。
   - 认证失败、权限拒绝或 non-fast-forward 不属于网络 fallback，直接停止。

   ```bash
   GIT_SSH_COMMAND='ssh -o ConnectTimeout=8 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=1' \
     git push origin "${release_branch}"

   git -c 'url.https://github.com/.insteadOf=git@github.com:' \
     -c credential.helper= \
     -c 'credential.helper=!gh auth git-credential' \
     push origin "${release_branch}"
   ```

5. push 成功后同时核对本地跟踪分支与实时远端 SHA。优先用已可用的 GitHub API，避免 SSH `git ls-remote` 再次等待；没有 `gh` 时才给 `git ls-remote` 加 12 秒超时：

   ```bash
   release_branch=$(git branch --show-current)
   release_head=$(git rev-parse HEAD)
   remote_head=$(gh api \
     "repos/sunbigfly/awesome-linuxdo-reader/branches/${release_branch}" \
     --jq .commit.sha)
   test "${release_head}" = "${remote_head}"
   git status -sb
   ```

只有远端 SHA 等于本地 `HEAD`、分支不再 ahead/behind，才写“GitHub 已同步”。A 后只批量核对本批 Raw Library/CSS，然后直接检查 Greasy Fork 目标版本与更新时间；更新时间未在 60 秒内变化时才查询 webhook delivery 或管理状态。

push 被拒绝时停止；瞬时网络失败按恢复点续传，不重新提交或重跑已通过的一致性检查。

## 4. 同步变化的 Greasy Fork Library

通过已配置的 GitHub Webhook 只同步哈希变化的 Library；不做论坛功能浏览器矩阵或性能观测：

1. push 前记录 UTC 时间；随后直接用 WebSearch 或 HTTP 读取 `https://api.greasyfork.org/scripts/<id>/versions.json?list_all=1`。不要先访问 `greasyfork.org` 主站 JSON、搜索非官方镜像或打开浏览器。API 会自行重定向到带 locale/slug 的 JSON 地址。
2. 在同一个进程中批量查询所有变化的 Library；同一时间产生多个版本时选择数组第一项，并仍以远端哈希为准。
   - Webhook 是否触发只看最新项的目标 `version` 与 `created_at` 不早于本次 push；不额外查询 delivery 或管理页。
3. 使用 `https://update.greasyfork.org/scripts/<script-id>/<version-id>/<file>.js` 固定 URL，不使用指向最新版的可变 Library URL。
4. 在同一个进程中下载所有固定文件，计算 bytes 和 SHA-256，并要求与本地生成文件完全一致。
5. 把真实 `scriptId`、`versionId`、固定 URL、bytes 和 SHA-256 写入 `published-libraries.json`；最终 README 坐标留到 C 一次写入，不增加“发布中”过渡提交。

API 未生成版本时前 30 秒按 2 秒间隔、之后按 5 秒间隔轮询，总计最多 60 秒。`api.greasyfork.org` 与 `update.greasyfork.org` 都不可用时才考虑浏览器；首次出现 Cloudflare 403 或挑战页就停止浏览器路径，不反复挑战。远端不一致、版本未生成或脚本 ID 不明确时停止，不伪造发布坐标。

## 5. 生成并核对最终 Loader

远端 Library 与 CSS 的不可变坐标成立后，使用同一个权威构建器生成最终 Loader。正常路径只执行一次写入构建：

```bash
node scripts/build-main-lite-greasyfork.mjs \
  --config work/greasyfork-lite/published-libraries.json \
  --consistency-only
```

构建后立即重新计算 Core、Platform、Features、CSS SHA-256 并与快照收据比较：

- 三个 Library 哈希均未变化：分包字节仍是已通过契约门的同一快照，不再运行 `main-lite:greasyfork:test`；
- 任一 Library 哈希变化：收据失效，停止发布并对新快照只运行一次 `npm run main-lite:local-debug`；
- 构建器或事实源在收据后变化、写入过程被中断、兼容副本不一致或 Loader 核对失败：只补一次同参数 `--check`，不要固定执行 build + check 双编译；
- `--consistency-only` 只跳过历史浏览器、性能和功能验收，不能创建“无需分包契约门”的例外。

随后核对：

- `@version` 与 `package.json`、手册版本一致；
- `@require` 固定到已核验的 Core、Platform 与 Features 版本并带 SHA-256；
- `@resource ldpReaderStyles` 固定到不可变 Git 提交并带 CSS SHA-256；
- 入口只读取统一模块 runtime 并启动一次；
- Loader 本身不超过 2 MiB。

## 6. 正式发布并收录线上证据

执行批次 B，按第 3 节相同的白名单、提交、普通 push 和远端 SHA 核验，同步：

- `lite/release-gate.json`；
- `published-libraries.json`；
- 最终 `work/main-lite.js`；
- `work/mian-lite.js` 兼容副本。

B 不提交临时发布状态、待定坐标或手册占位文案。README、安装说明、变更记录和发布坐标说明在主 Loader 固定 ID 成立后由 C 一次写成最终状态。

Greasy Fork 主脚本管理页必须保持：

```text
https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/main-lite.js
```

同步方式保持 Webhook。默认不打开管理页或执行“立即同步”；push 后直接从 `https://api.greasyfork.org/scripts/<loader-id>/versions.json?list_all=1` 读取目标版本和 `created_at`，更新时间不早于本次 push 即确认触发。只有同步源首次配置、需要变更设置或更新时间超时未变化时才进入管理页。随后核对：

- 主脚本版本历史出现目标版本和新的固定 version ID；
- 公开安装文件只包含薄 Loader、三条本项目 Library `@require` 和 CSS `@resource`；外部 KaTeX、pinyin-pro、hls.js 不计入本项目四文件数；
- 固定历史 URL 可能由 Greasy Fork 自动加入 `@downloadURL none`；移除这一平台行后应与仓库 Loader 字节和 SHA-256 一致；
- versionless 公开 `.user.js` 应包含 Greasy Fork 注入的 `@downloadURL` 与 `@updateURL`，`.meta.js` 的版本应等于目标版本；分发端短暂滞后时用 cache-buster 按 5 秒间隔轮询，最多 60 秒；
- 纯文档提交未误生成新的主脚本版本。

取得主 Loader 固定 version ID 后，按已批准范围只更新一次 Greasy Fork 主脚本公开介绍页，使其至少包含目标版本和最终 Loader/Core/Platform/Features ID。不要假设 GitHub README 或 Webhook 会更新这段正文。保存后从无需登录的公开页回读，并确认不存在旧“当前项目版本”或旧发布坐标；该回读和代码 `created_at` 是两项独立证据。若审批包未包含介绍页写入，停止并单独请求确认，不能宣称 Greasy Fork 已完整同步。

把公开 Loader 的固定 version ID、原始 bytes/SHA-256、移除 Greasy Fork 平台元数据后的 bytes/SHA-256，以及四文件固定坐标写入发布证据。若这一步产生文件变化，执行批次 C：

1. 先确认暂存差异中 `work/main-lite.js`、三个 Library 和 `work/main-lite.css` 均未变化；
2. 只提交发布证据和由该证据直接修正的 README/安装说明/变更记录；
3. 普通 push 并再次核对实时远端 SHA；
4. 不主动同步 Greasy Fork；直接从官方公开 API 核对主脚本 version ID 没有因纯证据提交变化。若意外创建版本，核验规范化字节完全一致并如实更新坐标，不隐藏多出的版本；只有公开结果异常时才排查 Webhook。

## 7. 更新并核对用户手册

按实际行为更新 README、安装说明、变更记录、功能目录和相关设置/使用页。只有界面确实变化才重新截图；截图必须来自唯一启用的四文件版。

只运行手册一致性检查，不重复构建站点。版本、frontmatter 或链接已经在 A 检查且 C 仅回填纯数字坐标时可复用 A 的成功结果；C 改动受校验字段时才重跑：

```bash
npm run docs:check
```

最终 C push 后优先用 `gh api` 查询与最终 HEAD 对应的一次 Documentation Actions run 和 Pages 状态；只有需要交互式等待时才退到 `gh run watch`。成功后用一次批量 HTTP 请求核对首页、安装页和更新记录的目标版本/Loader ID。Pages 尚未部署完成时不要把源码已推送冒充线上已更新。

## 8. 完成判定与收口报告

只有以下条件同时成立才报告“三大块已对齐”：

- 本地 `HEAD`、`origin/<branch>` 与 GitHub API 实时 SHA 相同，分支不 ahead/behind；
- 任务前 dirty 路径仍被保留，且没有进入任何提交；
- Loader/Core/Platform/Features 与 CSS 的本地、GitHub、Greasy Fork bytes/SHA-256 满足各自规范化规则；
- 公开主脚本和三个 Library 的固定 version ID 已记录；
- Greasy Fork 主脚本公开介绍页已回读为目标版本和最终四文件坐标，不再展示旧版本；
- 手册源码已推送，版本与发布坐标一致；GitHub Pages 在线状态单独报告。

交付时按顺序报告：

1. 用户可见结果和版本；
2. GitHub 提交、远端 `main` 与保留 dirty 路径；
3. Loader/Core/Platform/Features/CSS 的 bytes、SHA-256 和固定版本；
4. Greasy Fork 主脚本版本、同步源、公开更新时间和介绍页回读版本；
5. 手册版本、Pages 状态和任何尚未对齐项。
