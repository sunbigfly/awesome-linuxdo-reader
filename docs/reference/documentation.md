---
title: 文档维护规范
description: 规定功能目录、页面元数据、截图、版本同步和本地验证要求。
feature_ids: ["REF-002"]
source_anchors: ["@version"]
since: 0.1.2
version: 0.1.3
status: current
last_verified: 2026-07-23
screenshots: []
---

# 文档维护规范

用户手册是功能交付的一部分。只要 `work/main.js` 的用户可见入口、行为、设置、数据边界或故障恢复发生变化，就必须更新对应文档。

## 功能项字段

`docs/public/feature-catalog.json` 中每项必须包含：

| 字段 | 含义 |
| --- | --- |
| `feature_id` | 稳定唯一编号；已有编号不因改名重用 |
| `title` | 用户可识别的能力名称 |
| `category` | 阅读、互动、设置、数据等分类 |
| `description` | 一句话可观察行为 |
| `source_anchor` | 当前源码中的稳定符号或唯一控件标记 |
| `since` | 首次纳入可验证功能目录的版本 |
| `version` | 当前核验的 userscript 版本 |
| `status` | `current`、`experimental` 或 `deprecated` |
| `last_verified` | 最后通过源码/运行态核对的日期 |
| `screenshots` | 相关真实浏览器截图，可为空数组 |
| `docs` | 至少一篇手册页面 |

## 页面字段

所有公开手册页面必须维护 `title`、`description`、`feature_ids`、`source_anchors`、`since`、`version`、`status`、`last_verified` 和 `screenshots`。

页面 `feature_ids` 与功能目录 `docs` 必须双向匹配。源码锚点不用行号，因为大文件行号会频繁漂移。

## 一次功能更新的文档动作

1. 在当前源码中定位受影响入口和稳定锚点。
2. 新能力创建 `feature_id`；既有能力保留编号。
3. 更新对应分类手册和完整设置参考。
4. 更新版本、验证日期、状态和更新记录。
5. 只有界面结构或关键操作发生变化时更新截图。
6. 运行：

```bash
npm run docs:check
npm run docs:build
```

## 截图标准

- 通过真实浏览器采集，不用静态 HTML 冒充运行态。
- 展示一个明确功能状态，避免无关全页内容。
- 默认避开私信、凭据、Cookie、请求正文和仅当前账号可见的敏感内容。
- 仓库维护者明确授权时，公开页面、公开账号资料、头像、正文、通知摘要和统计可原样保留；当前 `guide-*` 批次按此授权未额外打码。
- 文件名使用稳定序号或功能名。
- Markdown 图片必须有替代文本，正文附近有说明。
- 不提交临时原图、HAR、Cookie、Token 或响应正文。

## 图标标准

- 用户手册界面和正文不使用 Emoji。
- 需要图形提示时使用本地内联的 Lucide SVG；图标仅作装饰时设置 `aria-hidden="true"`，可操作控件必须保留文字或可访问名称。
- 保留第三方图标许可证，不依赖外部图标 CDN 或运行时图标库。

## 完成标准

`docs:check` 必须显示：

- 未文档化功能 0；
- 缺失源码锚点 0；
- 版本漂移 0；
- Emoji 使用 0；
- 缺失链接、图片和必填元数据 0。

`docs:build` 必须完成 VitePress 生产构建。前端导航、搜索、暗色模式、截图和移动视口仍需真实浏览器抽查。
