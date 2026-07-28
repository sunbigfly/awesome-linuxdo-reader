# Greasy Fork 拆分工作区

此目录用于把当前单文件 userscript 逐步拆分成可独立发布和校验的 Greasy Fork 主脚本、Core Library 与非执行资源。

## 当前基线

- `main.user.js`：从当前 `work/main.js` 按字节复制，0.1.16 基线为 1,817,184 bytes，暂未接入 Core 或新资源。
- `main.css`：从当前 `work/main.css` 按字节复制，0.1.16 基线为 419,911 bytes。
- `reader-core.js`：由当前单一 IIFE 生成的 Core Library，0.1.16 为 1,815,195 bytes；加载后只注册命名空间，不会自动启动。
- `reader-assets.json`：由 23 个纯字面量模板、文案和配置常量生成。
- `icons.svg`：由 73 个通用图标和 35 个用户卡徽章图标生成，共 108 个 symbol。
- `build-resources.cjs`：从 `main.user.js` 可重复生成并校验 JSON/SVG；不属于发布文件。

本轮资源候选覆盖 25 个静态声明，源码初始值共 40,428 bytes。该数字是毛收益；真正接入后还需扣除资源读取、JSON 解析、SVG 挂载和访问适配代码。

## 目标发布映射

| 文件 | 发布位置 | 主脚本额度 |
| --- | --- | --- |
| `main.user.js` | 现有 Greasy Fork 普通脚本 | 计入 |
| `reader-core.js` | 新建 Greasy Fork Library | 独立计算 |
| `main.css` | GitHub/jsDelivr 不可变 `@resource` | 不计入 |
| `icons.svg` | GitHub/jsDelivr 不可变 `@resource` | 不计入 |
| `reader-assets.json` | GitHub/jsDelivr 不可变 `@resource` | 不计入 |

## 约束

- 迁移期间以 `work/main.js` 和 `work/main.css` 的当前行为为基线，不反向修改原文件。
- Core 必须暴露稳定 API，不得加载后自行启动。
- 不压缩、不混淆、不缩短变量名，不用动态下载后 `eval`。
- 资源 URL 必须固定到不可变提交并带完整性哈希。
- 发布顺序为 Core/资源先行，验证远端字节后再更新主脚本固定引用。
- 静态检查不能替代真实浏览器中的视觉、拖拽、滚动、请求和生命周期验收。
