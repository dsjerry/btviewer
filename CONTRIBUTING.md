# 贡献指南

感谢关注 BTViewer！欢迎通过 Issue 反馈问题、提交功能建议或 Pull Request。

## 反馈问题

提交 Issue 时请尽量包含：

- 应用版本（设置页"关于"卡片中的版本号）与操作系统；
- 复现步骤和预期/实际行为；
- 如涉及下载或解析问题，请附上磁力链接或资源名称（涉及版权内容的链接请自行打码）；
- 开发者工具（`Ctrl+Shift+I`）或终端中的相关报错日志。

## 开发环境

```bash
git clone https://github.com/dsjerry/btviewer.git
cd btviewer
npm install
npm run dev        # 启动开发环境
npm run typecheck  # 提交前运行类型检查
```

要求 Node.js 20+。Windows / Linux 会使用项目内 `resources/aria2` 的 aria2c；其它平台请通过 `ARIA2C_PATH` 指定。

> 提示：如果你的 npm 配置了本地代理但代理未启动，`npm install` 会失败，可临时追加 `--proxy=null --https-proxy=null`。

## 分支与提交

- 从 `main` 拉出功能分支：`git checkout -b feat/your-feature`；
- 提交信息使用英文祈使句概括变更（参考现有提交风格），正文可补充动机与实现要点；
- 一个提交聚焦一件事，重构与功能修复分开提交更利于回溯；
- 提交前确保 `npm run typecheck` 通过，并在应用内实际走一遍受影响的流程（解析 → 选择操作 → 下载/播放）。

## 代码约定

- 主进程（`electron/`）负责 aria2 RPC、流服务和持久化；renderer（`src/`）只做 UI 与交互，二者仅通过 preload 暴露的 IPC 通信；
- 渲染层不得直接访问 Node 能力；新增 IPC 时同步更新 `preload.ts` 与 `src/services/ipc.ts` 的类型；
- 对 aria2 的 RPC 调用注意参数形状（对象选项 vs 位置参数），并处理失败路径——不要静默吞掉会影响用户可见行为的错误；
- 任务状态映射、任务标识（infoHash 与 gid 的对应关系）是核心逻辑，改动前请先阅读 `torrent-engine.ts` 内的注释。

## 修改 logo / 图标

编辑 `resources/logo.svg` 后运行：

```bash
node scripts/generate-icons.mjs
```

会重新生成 `resources/icon.png / icon.ico / icon.icns`。

## Pull Request 流程

1. Fork（外部贡献者）或直接建分支；
2. 完成改动并自测；
3. 关联相关 Issue（`Closes #123`）；
4. 提交 PR，描述变更内容与验证方式；维护者会尽快 review。

## 行为准则

保持友好与专业，尊重不同的使用场景。请勿在仓库内发布受版权保护的资源链接。
