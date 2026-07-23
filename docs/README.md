# 文档

- [正式用户手册](index.md)：安装、阅读、互动、设置、数据管理、隐私和故障排查。
- [功能覆盖目录](reference/feature-catalog.md)：93 项当前用户能力及其源码、版本和文档映射。
- [完整设置参考](settings/reference.md)：全部设置项、范围、默认值与生效时机。
- [文档维护规范](reference/documentation.md)：功能更新时必须同步维护的字段和检查。
- [项目介绍素材](INTRODUCTION.md)：用于 GitHub、GreasyFork、发布页和社区介绍。
- [参与开发](../CONTRIBUTING.md)：源码约定、本地调试与验证流程。
- [安全策略](../SECURITY.md)：漏洞报告范围与脱敏要求。
- [userscript-dev](../tools/userscript-dev/README.md)：公开的元数据检查与本地加载器工具。

本地预览和生产验证：

```bash
npm install
npm run docs:dev
npm run docs:verify
```

历史设计稿与临时验证记录不属于公开用户手册，默认不参与 VitePress 构建。
