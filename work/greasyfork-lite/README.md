# Lite Greasy Fork 发布工程

该目录把 `lite/src/` 确定性构建成 Greasy Fork 可接受的可读发布单元，解决单个
userscript 超过 2 MB 的问题。构建不压缩、不混淆、不缩短标识符，也不下载后
`eval`；每个可执行文件使用 2,000,000 字节项目闸门，Loader 与两个 Library 的
项目自有 JS 总量另受 3,300,000 字节闸门约束。

## 产物

| 路径 | 用途 |
| --- | --- |
| `libraries/main-lite-core.js` | 应用、数据、Discourse、Shell、主题、流与 userscript 运行核心 |
| `libraries/main-lite-features.js` | 媒体、互动、设置、用户、通知、监控与其他功能模块 |
| `main-loader.template.user.js` | 等待填入固定 Greasy Fork Library URL 的薄主脚本模板 |
| `build-manifest.json` | 模块数、编译器、字节数与 SHA-256 |
| `published-libraries.json` | 已发布 Library 的真实 ID、固定 URL、同步 URL 与远端哈希 |
| `lite/contracts/release-browser-evidence.json` | 脱敏浏览器矩阵、性能、回滚与安全渠道证据 |
| `release.config.example.json` | 本地发布配置示例 |

两个 Library 只注册模块工厂，不会自行启动；全部 `@require` 到位后，薄主 Loader
才调用统一入口。跨 Library 依赖通过稳定模块路径解析，源文件路径和源码哈希保留
在产物中，便于 Greasy Fork 用户审查。每个 Library 都带独立的 Greasy Fork
元数据头，但 Library 模式不会被用户直接安装；其中的 `@match` 仅满足平台首次创建
时的元数据校验，实际运行站点仍完全由主 Loader 的元数据决定。

各模块仍保留独立可读工厂，但 esbuild 生成的 CommonJS helper 只在每个 Library
顶部声明一次，避免 238 个模块重复携带相同编译辅助代码。

## 构建与校验

```bash
npm run main-lite:greasyfork:build
npm run main-lite:greasyfork:check
```

不要直接编辑生成文件。修改 `lite/src/`、Lite 元数据或发布脚本后重新构建。

1.0.1 的 canonical 路径统一使用 `main-lite`。构建同时保留 `mian-lite` 旧拼写的 Library、CSS 和 Loader 兼容副本，且检查时要求新旧文件逐字节一致；Webhook 全部切换到新路径并复核后，旧路径才可在后续版本评估移除。

## 两阶段发布

1. 先提交并推送 `lite/`、`work/main-lite.css`、本目录 Library 与 manifest。
2. 在 Greasy Fork 创建两个 JavaScript Library，并分别配置从以下 GitHub 地址同步：

   ```text
   https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/greasyfork-lite/libraries/main-lite-core.js
   https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/greasyfork-lite/libraries/main-lite-features.js
   ```

3. 同步成功后，从每个 Library 的“代码”页取得带 `version` 查询参数的固定版本 URL；
   不使用指向最新版的可变 URL。
4. 首次发布前可复制 `release.config.example.json` 为被 Git 忽略的
   `release.config.json` 做草稿验证；远端发布成功并完成哈希核对后，把真实坐标写入
   受版本控制的 `published-libraries.json`。
5. 用第一阶段 Git 提交和当前 `work/main-lite.css` SHA-256 填写
   `lite/release-gate.json.readerStylesUrl`。只有真实浏览器、性能和回滚证据均完成时，
   才登记 `lite/contracts/release-browser-evidence.json` 并把对应门禁改为 `true`。
6. 生成最终薄 Loader：

   ```bash
   npm run main-lite:greasyfork:release
   ```

7. 逐字节核对 Greasy Fork 远端 Library 与 manifest 哈希，再把现有脚本
   [588185](https://greasyfork.org/zh-CN/scripts/588185-awesome-linuxdo-reader) 的同步源切到
   `work/main-lite.js`。主脚本更新成功后，再复核安装文件的版本、两个固定 `@require`
   和 CSS `@resource`。

`npm run main-lite:greasyfork:release` 只读取已核验的 `published-libraries.json`。
`release.config.json` 不进入 Git；其中没有凭据，但只作为首次发布草稿，不能用占位符
冒充已发布状态。

### v1.1.1 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1896707` | 固定文件 3,815 字节，SHA-256 `5952413827e817b4a4869e4db9e5485db336cec6ca9f6f801da29080d5d285bc`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `6a77c4f530b2689b3c7d26706861a2228e920d6b3873c49a17b032c82a71d7c0` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1896700` | 1,667,425 字节，SHA-256 `ebeef3251350931f86fd18079a493d9d32db70fa576857f435681975c8336dc9` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1896702` | 1,614,858 字节，SHA-256 `60ac5665a39c0745bf942b0ed5224917fcfe00486166ad9e047d050b8a21ebd0` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.1.1。

### v1.1.0 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1896519` | 固定文件 3,815 字节，SHA-256 `df17e8830bd03c5b7ba26c5551f3e7082f07b71499cc2afe25e370e65f896220`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `af454fdb6032514ef9fe05d47ad84d3c2d86403d1e27b8ede741e6cfa5847e00` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1896235` | 1,665,405 字节，SHA-256 `4f2b5b556da94f27e5d6e843f78d9fa24d44b36972fbf49afabf650e0c9a39a7` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1896236` | 1,613,871 字节，SHA-256 `0825bad2bb9f925f9b8ed7f1dd9bfbcf3bf9fef37853fbf6c4618c95a7b94abe` |

三个固定文件的 `@version`、字节数和 SHA-256 已在 `update.greasyfork.org` 同源环境核验为 v1.1.0；主 Loader 归一化后与仓库产物逐字节一致，16 页设置矩阵与五轮性能门禁均已通过。

### v1.0.1 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1895932` | Greasy Fork 固定文件 3,815 字节；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `8b1ac7799172508516ff009558dfab24e35e44ffa8fb548b092a50b1c5787ec5` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1895921` | 1,656,364 字节，SHA-256 `60dc23ad1611ddd466d785d96c6f3472d3e52cb2ef78fbd487ec2a4465da53c0` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1895924` | 1,550,452 字节，SHA-256 `27910eb1c7bf064ba9899938ed87672ccd85ab63512a5f5e2fe79b53912529bb` |

三个发布单元均保持 GitHub Webhook 模式，同步源已切换为 `work/main-lite.js`、
`libraries/main-lite-core.js` 和 `libraries/main-lite-features.js`；切换后立即同步均确认没有内容变化。

### v1.0.0 历史坐标

| Library | Greasy Fork | 固定版本 |
| --- | --- | --- |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1895870` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1895872` |

两项均已设置为从本仓库 `main` 分支的对应 Raw 文件进行 GitHub Webhook 同步；远端
字节数和 SHA-256 已在浏览器同源环境复核，并记录于 `published-libraries.json`。

### v1.0.0 主脚本历史基线

主脚本 [588185](https://greasyfork.org/scripts/588185) 已于 2026-08-07 同步为
v1.0.0，当前固定版本为 `1895905`。同步方式为 GitHub Webhook，源文件固定为：

```text
https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/mian-lite.js
```

Greasy Fork 固定版本仅比仓库 Loader 多平台自动加入的 `@downloadURL none`；移除该行
后为 3,794 字节，SHA-256 与仓库产物
`5cf2acfa3538821d35a29459581be680870b4b808c2615ab380cb2b7778d71c7` 一致。
公开安装 URL 仍由 Greasy Fork 注入 versionless `@downloadURL` 与 `.meta.js`
`@updateURL`，可正常接收后续自动更新。

## 后续扩容

`scripts/build-main-lite-greasyfork.mjs` 中的 `libraryDefinitions` 是唯一的 Library
清单，Loader 的 `@require`、运行时完整性检查、release config 和 manifest 都由它
派生。某个 Library 接近 2,000,000 字节项目闸门时：

1. 在 `libraryDefinitions` 增加一个职责明确的新 Library；
2. 在 `libraryForModule()` 按稳定的源码领域把模块迁入新 Library；
3. 重新构建并在 Greasy Fork 创建对应 Library；
4. 在本地 `release.config.json` 增加该 Library 的固定版本 URL；
5. 重新生成薄 Loader。入口模板和运行时协议不需要手工复制或改写。

不要为了让产物勉强低于平台上限而压缩或混淆。项目闸门比 Greasy Fork 的硬上限
保留额外余量；达到闸门就新增 Library，并保持每个源码模块只属于一个 Library。
