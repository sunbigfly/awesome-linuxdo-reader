# Lite Greasy Fork 发布工程

该目录把 `lite/src/` 确定性构建成 Greasy Fork 可接受的可读发布单元，解决单个
userscript 超过 2 MB 的问题。构建不压缩、不混淆、不缩短标识符，也不下载后
`eval`；所有可执行文件使用 2,000,000 字节项目闸门。

## 产物

| 路径 | 用途 |
| --- | --- |
| `libraries/mian-lite-core.js` | 应用、数据、Discourse、Shell、主题、流与 userscript 运行核心 |
| `libraries/mian-lite-features.js` | 媒体、互动、设置、用户、通知、监控与其他功能模块 |
| `main-loader.template.user.js` | 等待填入固定 Greasy Fork Library URL 的薄主脚本模板 |
| `build-manifest.json` | 模块数、编译器、字节数与 SHA-256 |
| `published-libraries.json` | 已发布 Library 的真实 ID、固定 URL、同步 URL 与远端哈希 |
| `release.config.example.json` | 本地发布配置示例 |

两个 Library 只注册模块工厂，不会自行启动；全部 `@require` 到位后，薄主 Loader
才调用统一入口。跨 Library 依赖通过稳定模块路径解析，源文件路径和源码哈希保留
在产物中，便于 Greasy Fork 用户审查。每个 Library 都带独立的 Greasy Fork
元数据头，但 Library 模式不会被用户直接安装；其中的 `@match` 仅满足平台首次创建
时的元数据校验，实际运行站点仍完全由主 Loader 的元数据决定。

## 构建与校验

```bash
npm run mian-lite:greasyfork:build
npm run mian-lite:greasyfork:check
```

不要直接编辑生成文件。修改 `lite/src/`、Lite 元数据或发布脚本后重新构建。

## 两阶段发布

1. 先提交并推送 `lite/`、`work/mian-lite.css`、本目录 Library 与 manifest。
2. 在 Greasy Fork 创建两个 JavaScript Library，并分别配置从以下 GitHub 地址同步：

   ```text
   https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/greasyfork-lite/libraries/mian-lite-core.js
   https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/greasyfork-lite/libraries/mian-lite-features.js
   ```

3. 同步成功后，从每个 Library 的“代码”页取得带 `version` 查询参数的固定版本 URL；
   不使用指向最新版的可变 URL。
4. 首次发布前可复制 `release.config.example.json` 为被 Git 忽略的
   `release.config.json` 做草稿验证；远端发布成功并完成哈希核对后，把真实坐标写入
   受版本控制的 `published-libraries.json`。
5. 用第一阶段 Git 提交和当前 `work/mian-lite.css` SHA-256 填写
   `lite/release-gate.json.readerStylesUrl`。只有真实浏览器、性能和回滚证据均完成时，
   才把对应门禁改为 `true`。
6. 生成最终薄 Loader：

   ```bash
   npm run mian-lite:greasyfork:release
   ```

7. 逐字节核对 Greasy Fork 远端 Library 与 manifest 哈希，再把现有脚本
   [588185](https://greasyfork.org/zh-CN/scripts/588185-awesome-linuxdo-reader) 的同步源切到
   `work/mian-lite.js`。主脚本更新成功后，再复核安装文件的版本、两个固定 `@require`
   和 CSS `@resource`。

`npm run mian-lite:greasyfork:release` 只读取已核验的 `published-libraries.json`。
`release.config.json` 不进入 Git；其中没有凭据，但只作为首次发布草稿，不能用占位符
冒充已发布状态。

### v1.0.0 已发布坐标

| Library | Greasy Fork | 固定版本 |
| --- | --- | --- |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1895781` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1895782` |

两项均已设置为从本仓库 `main` 分支的对应 Raw 文件进行 GitHub Webhook 同步；远端
字节数和 SHA-256 已在浏览器同源环境复核，并记录于 `published-libraries.json`。

## 后续扩容

`scripts/build-mian-lite-greasyfork.mjs` 中的 `libraryDefinitions` 是唯一的 Library
清单，Loader 的 `@require`、运行时完整性检查、release config 和 manifest 都由它
派生。某个 Library 接近 2,000,000 字节项目闸门时：

1. 在 `libraryDefinitions` 增加一个职责明确的新 Library；
2. 在 `libraryForModule()` 按稳定的源码领域把模块迁入新 Library；
3. 重新构建并在 Greasy Fork 创建对应 Library；
4. 在本地 `release.config.json` 增加该 Library 的固定版本 URL；
5. 重新生成薄 Loader。入口模板和运行时协议不需要手工复制或改写。

不要为了让产物勉强低于平台上限而压缩或混淆。项目闸门比 Greasy Fork 的硬上限
保留额外余量；达到闸门就新增 Library，并保持每个源码模块只属于一个 Library。
