# userscript-dev

`userscript-dev` 是 Awesome LinuxDo Reader 自带的开发辅助工具，用于检查 userscript 元数据、列出静态请求入口，以及生成和验证 Tampermonkey 本地调试加载器。

## 环境要求

- Rust 与 Cargo，可从 [rustup.rs](https://rustup.rs/) 安装。
- Bash（Linux、macOS、WSL 或 Git Bash）或 PowerShell 5.1 及以上版本。

首次运行时 Cargo 会按 `Cargo.lock` 下载并编译依赖，编译结果保存在系统临时目录，不会写入仓库。后续运行会复用该缓存。

## 使用方式

Bash：

```bash
./scripts/userscript-dev --json doctor
./scripts/userscript-dev --json inspect work/main.js
```

Windows PowerShell：

```powershell
.\scripts\userscript-dev.ps1 --json doctor
.\scripts\userscript-dev.ps1 --json inspect work/main.js
```

生成本地调试加载器：

```bash
./scripts/userscript-dev --json make-loader work/main.js --out work/local-debug.user.js
./scripts/userscript-dev --json verify-loader work/local-debug.user.js --source work/main.js
```

工具默认拒绝覆盖已有加载器。确认目标文件可以覆盖后，才可在 `make-loader` 命令末尾添加 `--force`。

连续录制 Chrome 标签页：

```bash
./scripts/userscript-dev --json record \
  --endpoint 127.0.0.1:9222 \
  --target-url linux.do \
  --duration 6 \
  --fps 15 \
  --width 1440 \
  --height 900 \
  --quality 94 \
  --out /tmp/linuxdo-reader-demo
```

录制前需要用 `--remote-debugging-port=9222` 启动 Chrome。`record` 直接使用 Chrome DevTools Protocol 的 screencast 能力，输出固定帧率的编号 JPEG；页面静止时会复制最近一帧，以保证时长和帧率稳定。输出目录必须不存在，避免覆盖已有素材。

如果远程调试端口的 HTTP 目标列表被代理层屏蔽，可以改传浏览器级 WebSocket：

```bash
./scripts/userscript-dev --json record \
  --browser-websocket ws://127.0.0.1:9222/devtools/browser/<id> \
  --target-url linux.do \
  --duration 6 \
  --fps 15 \
  --out /tmp/linuxdo-reader-demo
```

## Tampermonkey 设置

1. 运行 `make-loader`。
2. 在 Tampermonkey 中导入 `work/local-debug.user.js`。
3. 在扩展设置中启用“允许访问文件网址”。
4. 停用正式版脚本，只保留本地调试版。
5. 保存 `work/main.js` 后刷新 LINUX DO 页面。

加载器的最后一个 `@require` 会指向当前机器上的源码绝对路径。工具支持 Linux、macOS、WSL 和原生 Windows 路径，并会对路径中的空格和非 ASCII 字符进行 URL 编码。

## 输出约定

标准输出为单个 JSON 对象：

- `ok: true` 且退出码为 `0`：命令通过。
- `ok: false` 且退出码为 `2`：参数、元数据、加载器或环境检查失败。

`inspect` 给出的网络调用行号属于静态候选位置，不能替代浏览器 Network 与 Initiator 取证。
