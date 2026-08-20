# Lite Greasy Fork 发布工程

> `1.5.9` 已完成 GitHub、Greasy Fork 四文件链、公开介绍和用户手册同步；本节记录当前不可变坐标与逐字节核验结果。

Greasy Fork 主脚本公开介绍的同步源是仓库根部 [`GREASYFORK.md`](../../GREASYFORK.md)，共享长介绍维护在 [`docs/INTRODUCTION.md`](../../docs/INTRODUCTION.md)。本文件只维护四文件构建、固定坐标和发布证据。

该目录把 `lite/src/` 确定性构建成 Greasy Fork 可接受的可读发布单元，解决单个
userscript 超过 2 MB 的问题。构建不压缩、不混淆、不缩短标识符，也不下载后
`eval`；每个可执行文件使用 2 MiB 硬闸门。

## 产物

| 路径 | 用途 |
| --- | --- |
| `libraries/main-lite-core.js` | 应用、Shell、主题、流、布局与 userscript 运行核心 |
| `libraries/main-lite-platform.js` | 缓存、集合、Discourse、网络、队列、同步、通知与监控平台模块 |
| `libraries/main-lite-features.js` | 媒体、互动、设置、用户、翻译与其他功能模块 |
| `main-loader.template.user.js` | 等待填入固定 Greasy Fork Library URL 的薄主脚本模板 |
| `build-manifest.json` | 模块数、编译器、字节数与 SHA-256 |
| `published-libraries.json` | 已发布 Library 的真实 ID、固定 URL、同步 URL 与远端哈希 |
| `lite/contracts/release-browser-evidence.json` | 脱敏浏览器矩阵、性能、回滚与安全渠道证据 |
| `release.config.example.json` | 本地发布配置示例 |

三个 Library 只注册模块工厂，不会自行启动；全部 `@require` 到位后，薄主 Loader
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

每次 Lite 变更使用统一入口生成两套本地审查产物：

```bash
npm run main-lite:local-debug
```

该命令先生成单文件 `work/main-lite.local.js`，再由同一个 Greasy Fork 构建器生成
Core、Platform、Features 和 `work/main-lite.greasyfork.local.user.js`。四文件本地 Loader 使用
`file://` 引用本仓库三个 Library 与 CSS，并禁用自身更新；因此手动审查的三个
Library 与待发布文件完全相同。快速调试版和四文件本地测试版不可同时启用。

1.0.1 的 canonical 路径统一使用 `main-lite`。构建同时保留 `mian-lite` 旧拼写的 Library、CSS 和 Loader 兼容副本，且检查时要求新旧文件逐字节一致；Webhook 全部切换到新路径并复核后，旧路径才可在后续版本评估移除。

## 两阶段发布

1. 先提交并推送 `lite/`、`work/main-lite.css`、本目录 Library 与 manifest。
2. 在 Greasy Fork 创建三个 JavaScript Library，并分别配置从以下 GitHub 地址同步：

   ```text
   https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/greasyfork-lite/libraries/main-lite-core.js
   https://raw.githubusercontent.com/sunbigfly/awesome-linuxdo-reader/main/work/greasyfork-lite/libraries/main-lite-platform.js
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
   `work/main-lite.js`。主脚本更新成功后，再复核安装文件的版本、三个固定 `@require`
   和 CSS `@resource`。

`npm run main-lite:greasyfork:release` 只读取已核验的 `published-libraries.json`。
`release.config.json` 不进入 Git；其中没有凭据，但只作为首次发布草稿，不能用占位符
冒充已发布状态。

### v1.5.9 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1908038` | 固定文件 4,172 字节，SHA-256 `572bf549b8f4e6f78e55f790f767e747f4ac5b7c889f06a3ed933cc5847b4bfa`；移除平台加入的 `@downloadURL none` 后为 4,151 字节，SHA-256 `447b76c84b37710b0f96e716630bbaa7703f2d776fb24ff28b3ed83edf1e80ba` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1908030` | 1,648,152 字节，SHA-256 `b9b6a04fad31f9a4a95897280cb4f71338e8f190a8c1cbd1888a87bbf8ea2067` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1908032` | 1,324,604 字节，SHA-256 `feb52296c03beb63c10913f5ac42d0c10a94afa9acfef7b21d5f93891cdbfde8` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1908031` | 2,055,551 字节，SHA-256 `f2b624cc16bcb3bda9b9c9976dc4e9c8fea9eb0a0a6c5b95e50c919555ececa4` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `f69dcab7529c58401416fa37f2226d28801423b4`，621,735 字节，SHA-256 `637ea0390be63c8f8b39a5282dcf3a5d211d50b906ed1b193333ca0e0d588e0a`。

### v1.5.8 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1905757` | 固定文件 4,172 字节，SHA-256 `88e374895507054b891e38f65e11f15675efa8ff7812c245530e377f60c85283`；移除平台加入的 `@downloadURL none` 后为 4,151 字节，SHA-256 `bcfac33f6930e9503084b5a517568fbe63d06ad3eac43dfeccc2d768cd529e31` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1905755` | 1,588,128 字节，SHA-256 `e915a5b265c8e9489ec5950de7759a3009ff4a39b357cedb504bb0697faea7a9` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1905756` | 1,271,756 字节，SHA-256 `800e8d44f12ef436c0fdd41f09f652407ad43f6347c34ed6013cd4aff58e3cf2` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1905742` | 2,045,403 字节，SHA-256 `d45214197eabafce29f09ce2b1b3ae1248668b46fb1be1716758b598a41032ff` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `ac10f7f3dfed908f2e3b184690eca734503e5fb9`，619,781 字节，SHA-256 `442ff6a5ffbfd3f0f3cd17d61fccac07cf680d80dfae8abf1cee571dd5502eb4`。

### v1.5.7 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1905671` | 固定文件 4,141 字节，SHA-256 `015ebc99782d0931168ffdf4c3156c3e454c1adacb9f9b07b2e9ddf93e571d6e`；移除平台加入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `ac327dd89f9414fb5ebb86792947c10d5c0bd1c6ac122d08e6834afd6460de91` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1905668` | 1,586,385 字节，SHA-256 `9088ae605be56fb1290cc5078387f6c0bb28f59bf9cff1db0ecc0e269bc87454` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1905670` | 1,270,087 字节，SHA-256 `ed946f30a5c9ad22f9848344d87456597d9c05557570d48f85cbde668075c625` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1905669` | 2,011,170 字节，SHA-256 `db9097d4cbbacaee2802c297938b669d03cdda2f4d9fd34aa0dc69c828c05e09` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `4efa0f4b3521432b021d739cb7ae07fadb51ac54`，619,328 字节，SHA-256 `84a60f90455c91470883300f0505e0c9c744b5e6ae2c02626989ef85e00ed4e1`。

### v1.5.6 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1905255` | 固定文件 4,141 字节，SHA-256 `4f3d6a36555366d861102770d1afa86e2734101e7f4a99ad86287d4c9491c91b`；移除平台加入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `bf5b30b9e9f32357e6b7b209ccce6ea58337933fa73145e1960c60b590c4c57f` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1905251` | 1,579,089 字节，SHA-256 `972a573d72ce74adfec25533b6246a2cb2606ef287c68a23949a9bf7138859c3` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1905253` | 1,270,005 字节，SHA-256 `6ee6f3753b1526b0123902cc3f0f90d42b650eac2acab0e312814e50d881a643` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1905252` | 1,974,596 字节，SHA-256 `1afc5183bdd7299bd96b8c9ded9c63e1af492208355671753327c51af9726e56` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `4556cdb2353b721ac38bc2a6a27f17d171b025ee`，613,145 字节，SHA-256 `c5bee6e150df42c17f121c4e049822b2babca3caf0138b9cf5d43595d7958c14`。

### v1.5.5 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1905077` | 固定文件 4,141 字节，SHA-256 `0c1b2ee8c8962326ddac703677cab7672f1d48254948e530ae763a91ea3f6e54`；移除平台加入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `08cad5236f0780e7010bde7fbf01e373d6595485323c9777c1cf02586a370ab3` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1905073` | 1,578,578 字节，SHA-256 `c800a4ecf7ddbfdf8fa797fe2af91f27e01a0389aff51661af07f348376028b5` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1905075` | 1,259,412 字节，SHA-256 `22d0870e9882f542b8b4655c64b2e53970d45824359b3ea853ed88960b78a2ba` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1905074` | 1,974,596 字节，SHA-256 `163b9eada11b3ac7b305e11fd5e6fb15cd627fcfaa9248b14fb0e6ca2c361337` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `a5bd471c10bf1d40b85e50148c90087489cae584`，612,476 字节，SHA-256 `e3801f8a0c868d101cd0a9d798146b1fc394c82e5535ed9a89b8cf9501f1ed2b`。

### v1.5.4 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1905015` | 固定文件 4,141 字节，SHA-256 `6624fe32bd06a79ef8ec1f58fc93910ade3fc844c6891496e3dafec43b5e9474`；移除平台加入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `66c9b81ed37c4d8f4135ec7522c89e813b82cb15b708ed3327706de98422422e` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1905010` | 1,577,128 字节，SHA-256 `3fa3487b444baf95ab951e2a98296d0822a1fd49f4ab4b932ab28473c86429db` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1905012` | 1,257,549 字节，SHA-256 `fe3451175591ba4e283a347064538c6bba95e0b8bceb9d513c259cb3be25706a` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1905011` | 1,974,596 字节，SHA-256 `f7ec6a944e15e1f065ff26c1f7f36420514eaf5dc5b5455d18af5265a29f2d29` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 没有变化，继续固定到 Git `25fb1508884e8e524e381c1a7942e9729f41d52d`，611,633 字节，SHA-256 `1bce472ab2eecf03f62579975724661d11c8e1839b13cb837c92ae2edbe2f40d`。

### v1.5.3 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1904932` | 固定文件 4,141 字节，SHA-256 `bb6374f118161cc03d95e034604dc12f6c6632d60d1356ff95407eaa48145125`；移除平台加入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `286aa954fd84f05dc655595829a06d8e89840ef7ebb28ed449e5c52b3a0fb2e6` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1904928` | 1,576,024 字节，SHA-256 `9f44b8cb4350ba6329fb9a2695f7763c981543de39cf48ffb003f96dcc4133d6` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1904930` | 1,257,429 字节，SHA-256 `ddcbd496344a0fb0f56eabf8cee488bc7b5809013b4384dd45fb76bcf52eaebf` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1904929` | 1,974,461 字节，SHA-256 `aa66562e721213e6c13432848be564b2c7fbefd77a2eb7d3dc849f237ef980bf` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `25fb1508884e8e524e381c1a7942e9729f41d52d`，611,633 字节，SHA-256 `1bce472ab2eecf03f62579975724661d11c8e1839b13cb837c92ae2edbe2f40d`。

### v1.5.2 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1904498` | 固定文件 4,141 字节，SHA-256 `8e2f3aa1b2dabeaf2ca276ddc639f864cfa78b8a50179bd38c824dadb2f15d2e`；移除平台加入的 `@downloadURL none` 后为 4,120 字节，SHA-256 `5265fd8e3496c432938053bdd3e19b01e64b316aff401ebfa80d50a68af4c216` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1904487` | 1,572,987 字节，SHA-256 `d06e345a438a2255c27251f61c9d29810034841ca9b52a565463ac35d461f938` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1904489` | 1,244,026 字节，SHA-256 `00e240f9860bae3179c863809a76dc847260bab683189126d2f499d2ab793ea1` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1904488` | 1,965,693 字节，SHA-256 `818da987ac607ab5253394779b56128ce58a1f22cea8c35b8978d87fc6356204` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `7c25413b2eb2b2e9a30d33c5a346f858751eb1cc`，610,968 字节，SHA-256 `4c6ae29067770d2553befee1c7ac7ddb61d347abdfb6fa8bf23b6c50f52f10b1`。

### v1.5.1 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1904337` | 固定文件 4,052 字节，SHA-256 `d0e7779a622dcf35274534fea5d52407e570ead3f11a98aa0e95631f72e4e2ec`；移除平台加入的 `@downloadURL none` 后为 4,031 字节，SHA-256 `ada5e1d68dd694bfd07469aab407307ba1c4ee4f59322146c80ff04448f5f0f6` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1904332` | 1,552,280 字节，SHA-256 `94de6f182860d14bc7f0ec99ec85b18a5439ee8bd22813a73479f812d2d7ca21` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1904334` | 1,236,505 字节，SHA-256 `c711741eda054d237d02184bdad29c5c87c34c798627c99dc7021f29448ec329` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1904333` | 1,954,095 字节，SHA-256 `940111bfafb2164d02d683ff93cefef60bd58c0c5550ecadac38e221f6477a5c` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；主 Loader 归一化后与仓库产物逐字节一致。CSS 固定到 Git `c815193e4b094b1109998dabbf4fcb5c0bb8fd0d`，610,772 字节，SHA-256 `d26719a138478e12108b93c9df82918ac860c5cbe8387e7a4ad804a7cde97f1e`。

### v1.5.0 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1904252` | 固定文件 4,052 字节，SHA-256 `60a80af4e514c5131b572a1e8afb44dcf80cce7a82fe967ceb2293d96ef383e3`；移除平台加入的 `@downloadURL none` 后为 4,031 字节，SHA-256 `f396fbf42eca4cd0f761557cb330577034225e3967bee33f6877467f40821d5f` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1904245` | 1,552,321 字节，SHA-256 `a645aa16ac2592f591e2fcb0aceb9057b9e43adb9f8f21bb00e5a401eb8d804a` |
| Platform | [591595](https://greasyfork.org/scripts/591595) | `1904248` | 1,236,060 字节，SHA-256 `b8755569a5591fc106e2faac433e136bbbbfd3d548dc4b9369a953747f60a178` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1904246` | 1,953,979 字节，SHA-256 `9316bcefe26cb24f78e6fb87dadc523e71f37c4642324c4ba9475d10a6993053` |

四个发布单元已在 `update.greasyfork.org` 固定版本 URL 核验；versionless 安装文件与元数据均为 v1.5.0。CSS 固定到 Git `2a1f6695162217d4a86cf0e3958d8a361594f90b`，610,039 字节，SHA-256 `db6d4a47f0fb07f002907a6c9788f730f233b902d548238da0023a46182a026a`。

### v1.3.1 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1899428` | 固定文件 3,815 字节，SHA-256 `f318841bd36569a6eb2154ce8ddb0ba707146f66b2e761938156e83cd3ee0f6d`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `9c20d6b707321cf1e928b7fff24e6e379501a08d27a0ac63cfa082315edabdf6` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1899419` | 1,682,561 字节，SHA-256 `4a5a9a0f67214f7b696f107ee3dfd0d628fa9328c0d8470ee41eb6bbc7396154` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1899422` | 1,841,067 字节，SHA-256 `e1919d8b5ec69c62cb9f875621ca0e69d6274f3f8600ac2b0f62e1aed69364e9` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.3.1。CSS 没有变化，继续固定到
Git `5ca40cf3025951dbcb94edde29ebb59083c2bb4f`，472,279 字节，SHA-256
`f438522f298ca3a15363685bd8ef5e33e1a5b17c57e801784018a0fbf418a3b4`。

### v1.3.0 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1899377` | 固定文件 3,815 字节，SHA-256 `cb977d5f6f392d8e99bc5640055bf16be94408fe065900d7ad865dceb777f2f6`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `3e4c975eb214efed857992963c59d730ab67c32ea8779d639f278c6ba326bc7b` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1899370` | 1,682,450 字节，SHA-256 `c3ee925dd30dcf7f831fe0e9d393556db9f1fb1429d7e62ba193f9a56dde7b91` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1899372` | 1,839,648 字节，SHA-256 `fa426f71facd50d81e60aa2cb5c7c3ff0a3e11c627d8f372f758b118edbf1345` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.3.0。CSS 固定到 Git
`5ca40cf3025951dbcb94edde29ebb59083c2bb4f`，472,279 字节，SHA-256
`f438522f298ca3a15363685bd8ef5e33e1a5b17c57e801784018a0fbf418a3b4`。

### v1.2.5 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1897778` | 固定文件 3,815 字节，SHA-256 `ef3667b61ec08f4d2effa6785b100d57f8252b86631a5afc742f8bf64bec0d26`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `45782a588ef6e79eef771014450f38ba8858b5c88c2cb349e3d2fd20532ff985` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1897774` | 1,595,702 字节，SHA-256 `39dcc7a44c441ff8644984e908ff93aa41a3fdd757072c2e7f85ce0ad838d5c1` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1897776` | 1,631,330 字节，SHA-256 `f61355857736fe1bc73b4d3d7e84cf5055bc2d390834d4452109dfa94cb971ce` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.2.5。CSS 固定到 Git
`3caf8237d91b97a2d90747db748cf9524dcbfda2`，449,576 字节，SHA-256
`4602b5396a2e1fcf788d05a7a6a3e24b63940259225e73898858cacf6f6fd125`。

### v1.2.4 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1897749` | 固定文件 3,815 字节，SHA-256 `93020ca836aae6a78a41da5b553787f2cefeba428b3ac44ecf684f102e4da276`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `4a87835f00b42a9430207e8b37ee50626140f0ab87dd0870829e8f2976e82be5` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1897745` | 1,594,563 字节，SHA-256 `29c44aaed64b1591114f29cc849f0f5e879c77b88a7192ddb93851389474b77a` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1897747` | 1,631,330 字节，SHA-256 `bef258db76a0457fd0f420a0545b37891334ab2b2631d49867321792d18eaeb7` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.2.4。CSS 固定到 Git
`cf398703c1e8c1c900c1eaca103d29bdb027050f`，448,993 字节，SHA-256
`0348e18154ce56f4edd34d160dea6a375f37d8fc6d0ce19ce80b1941117d69f7`。

### v1.2.3 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1897714` | 固定文件 3,815 字节，SHA-256 `cd9eb04a81e40e6b108251db362b3883f75a43a38e23752b4b72c45280797c4f`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `9ff81d027133c407cd3a7d9df2e34d530dec563ccc439c835685aa6d0edb3ae6` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1897707` | 1,594,066 字节，SHA-256 `7494f406be1cf585ed5d0e9c8e92b1bc5fee38a6805720502329868c6b5a6a27` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1897709` | 1,631,159 字节，SHA-256 `12be5667f51327bb8776955aa058cbe56cbd9afa70dc702829463cca089171d5` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.2.3，Loader 主页指向 GitHub
Pages。CSS 固定到 Git `cf398703c1e8c1c900c1eaca103d29bdb027050f`，448,993 字节，
SHA-256 `0348e18154ce56f4edd34d160dea6a375f37d8fc6d0ce19ce80b1941117d69f7`。

### v1.2.1 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1897662` | 固定文件 3,815 字节，SHA-256 `773fc7508f2259b9a77c83e547a7aaf04062b07682b09d69db5ae72a4dd1fd4a`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `66c89d08a9236deadc4673f0003ed1bcc2cc3ed25a81344220d6748532bc2c3b` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1897653` | 1,594,080 字节，SHA-256 `0c8146588acf63453b18002b539c8f35b369e15975b62db54699ac939d676b84` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1897656` | 1,631,347 字节，SHA-256 `a898198bd59dfc879db78291e248be741609c965c7679ad16d5567cdc304a4bc` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.2.1。CSS 固定到 Git
`cf398703c1e8c1c900c1eaca103d29bdb027050f`，448,993 字节，SHA-256
`0348e18154ce56f4edd34d160dea6a375f37d8fc6d0ce19ce80b1941117d69f7`。

### v1.2.0 已发布坐标

| 发布单元 | Greasy Fork | 固定版本 | 核验结果 |
| --- | --- | --- | --- |
| 主 Loader | [588185](https://greasyfork.org/scripts/588185) | `1897520` | 固定文件 3,815 字节，SHA-256 `05981b1e23e5b32dbc2a16791b6cd9c58d9830cb38d883a8170ac4f61342f62e`；移除平台加入的 `@downloadURL none` 后为 3,794 字节，SHA-256 `d2a178cde32774c29e1396233de9ff5a2992165a490e85d3d83d8b99aeb7f0b9` |
| Core | [590254](https://greasyfork.org/scripts/590254) | `1897517` | 1,581,732 字节，SHA-256 `9f896292334b39dd46520e778389d333814c3252b6bca46b8e83a2377a992c88` |
| Features | [590255](https://greasyfork.org/scripts/590255) | `1897519` | 1,629,379 字节，SHA-256 `6295f0eeff188e2d5c2385a01b8f259dfb449441c83fc839df96a668d193736a` |

三个发布单元均已通过 GitHub Webhook 同步，并在 `update.greasyfork.org` 固定版本 URL
逐字节核验；versionless 安装文件与元数据均已更新为 v1.2.0。CSS 固定到 Git
`108c3a102eee9b70c98279a198eb579addf49bf2`，448,723 字节，SHA-256
`12555b39cf01a9e3471e2ef1a0c44603ebc5d11805e37a9d227f2f093700ce6f`。

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
派生。某个 Library 接近 2 MiB 硬闸门时：

1. 在 `libraryDefinitions` 增加一个职责明确的新 Library；
2. 在 `libraryForModule()` 按稳定的源码领域把模块迁入新 Library；
3. 重新构建并在 Greasy Fork 创建对应 Library；
4. 在本地 `release.config.json` 增加该 Library 的固定版本 URL；
5. 重新生成薄 Loader。入口模板和运行时协议不需要手工复制或改写。

不要为了让产物勉强低于平台上限而压缩或混淆。分包时主动保留增长余量；接近闸门
就新增 Library，并保持每个源码模块只属于一个 Library。
