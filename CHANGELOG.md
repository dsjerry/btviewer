# 更新日志

> 本文件从 1.1.0 起维护；更早版本的变更请查看 [GitHub Releases](https://github.com/dsjerry/btviewer/releases)。

## [Unreleased]

### 变更

- 内置 macOS Apple 芯片版 aria2c（1.37.0，AppleTLS + 静态 c-ares，ad-hoc 签名），mac 版开箱可用
- aria2 二进制改为按 `平台-架构` 分目录（`resources/aria2/<win|mac|linux>-<x64|arm64>/`），打包时只复制当前构建目标的那份；新增 `resolveAria2Binary` 纯函数并补单测
- `npm run package:mac` 改为只出 Apple 芯片（arm64）包，universal 移到 `package:mac:universal`

### 重构

- 本地媒体流服务（`/stream`、`/subtitle`、`/compat`）从 `torrent-engine.ts` 拆出纯逻辑到 `electron/stream-server.ts`：
  路由解析、token 常量时间比较、目录越界判定、Range 响应头统一由纯函数决定，并补 15 例单测
  （含 `../` 穿越、`/stream/abc/../1` 注入、非法百分号转义、416/空文件等分支）
- 流式读取补上中断处理：播放器 seek 打断请求时销毁读流，避免文件句柄泄漏

### 优化

- 任务状态去重不再用 `JSON.stringify` 比较整棵对象树（含 files 数组）：改为逐字段比较，
  100 任务 × 200 文件时单次判定从 3.2ms 降到 0.09ms（约 35 倍），列表或文件行 memo 都不会再因
  「内容没变但对象是新的」触发重渲染
- 设置页按平台能力显示开关：mac 上不再出现无效的「关闭窗口时最小化到托盘」；未签名的 mac 构建
  不再显示「开机自启」，改为说明如何在系统设置里手动添加
- 开机自启改为回读系统登录项状态：系统拒绝登记时（mac 未签名 / 不在 /Applications）如实回到关闭态
  并写入日志，不再显示一个并不生效的「已开启」
- 主进程所有输出统一走 `logger`（窗口加载失败、引擎启动、二次启动等），打包版也能在应用内日志页看到；
  只有 `--diagnostics` 的 stdout 仍保留 `console`

### 构建与发布

- 未配置 Developer ID 证书时，release 流程对 macOS 包自动做 **ad-hoc 签名**并重新封装 dmg/zip：
  消除未签名 arm64 二进制导致的「已损坏，无法打开」，用户只需一次右键 → 打开
- 签名证书/公证凭据全部走 secrets，缺失时自动降级并在日志给出 warning；最终包既非 Developer ID
  也非 ad-hoc 时 CI 直接失败，避免发布一个双击就无法打开的包
- Release 正文自动附加安装说明（macOS 首次打开方式、Windows SmartScreen、Linux 安装命令）
  - README 新增安装章节与签名状态对照表，说明未签名构建不支持开机自启
- CI 校验内置 macOS 二进制的部署目标（`vtool` 读 minos）：高于 runner 系统版本直接失败，防止再提交旧系统无法运行的二进制

### 修复
- **macOS / Linux 不再要求用户敲 `pip install yt-dlp`**
  - yt-dlp 自动安装覆盖三平台：官方 `yt-dlp_macos`（universal）、`yt-dlp_linux`、`yt-dlp_linux_aarch64`、Windows arm64/x86 构建，统一 SHA2-256SUMS 校验
  - deno 自动安装覆盖三平台（zip 解压用系统自带工具：Windows tar.exe、macOS ditto、Linux unzip）
  - macOS 安装包内置 ffmpeg/ffprobe（Apple 芯片原生，libx264 + VideoToolbox），启动时自动就绪，不需要下载
  - Apple 芯片上不再尝试下载只有 Intel 版的 evermeet 构建：直接给出可执行的下一步，而不是让用户看到「架构不匹配」
  - 安装完成的二进制统一补 0755 权限（macOS 下载文件默认不可执行）
  - Linux 上仅当 ffmpeg 无法一键安装时给出面向普通用户的提示（软件中心安装），不再出现开发者向命令

- **macOS**
  - 侧栏标题为窗口左上角红绿灯按钮留出空间（`html[data-platform='darwin']`）
  - 保留最小可用的原生菜单（应用 / 编辑 / 窗口），修复清空菜单导致 ⌘C/⌘V/⌘W 失效；新增「设置…」（⌘,）与菜单跳转事件 `app:navigate`
  - 关窗改为真正的关闭窗口（应用留在 Dock），点 Dock 图标或 ⌘Tab 经 `activate` 重建窗口；mac 不再创建菜单栏托盘图标
  - 开机自启改用登录项 `openAsHidden`，不再向登录项塞自定义参数
- 关窗后主进程驻留时，`window-all-closed` 只停 aria2/转码、不退出进程；引擎 `destroy()` 改为幂等，避免重复清理
- 无托盘的 Windows/Linux 环境关窗后不再残留后台进程
- 诊断信息新增「aria2 路径 / 未找到」一项，便于排查分平台发布时二进制放错目录
- 内置 macOS 二进制（aria2c 1.37.0 / ffmpeg / ffprobe 7.1.1）改用 `MACOSX_DEPLOYMENT_TARGET=11.0` 重建，特性与依赖不变：
  此前跟随本机系统默认目标编译，二进制引用了 macOS 13/14+ 才有的符号（aria2c 静态链接的 c-ares 还引用了 macOS 26 才加入的 `_pipe2`），
  在真实用户机器（macOS 11–14）和 CI runner 上 dyld 加载即中止

## [1.1.0]

### 新增

- **系统集成**
  - 文件关联与协议注册：双击 `.torrent` / `.metalink`、点击网页 magnet 链接即交给已运行的实例处理（magnet 关联默认关闭，可在设置页开启）
  - 单实例运行：重复启动只把输入转给已有实例，避免出现多个 aria2 进程与多份任务记录
  - 全局下载/上传速度显示、托盘统计与侧边栏一键限速
  - 队列完成后动作：打开目录、打开文件、退出、关机、睡眠（关机留 60 秒取消窗口，Windows 可用 `shutdown /a` 取消）；点击完成通知可跳转到对应任务
  - 剪贴板监听（默认关闭）：复制到磁力/直链时在应用内提示添加，不会自动下载
  - 应用内日志查看（按文件与级别过滤）与「复制诊断信息」（自动隐藏代理账号密码与本机用户名）；命令行 `BTViewer.exe --diagnostics` 输出同一份诊断
  - 界面中英双语（432 条词条，缺英文自动回退中文），设置页可切换
  - 更新检查：查询 GitHub Releases 最新版本号并在设置页提示（只读接口，不自动下载）
- **下载引擎与队列**：边下边播优先分片、协议分流与降级序列（BT / 直链 / 视频站点 / Metalink）、失败自动重试（指数退避）、做种策略（分享率 / 时长）、单任务限速、任务清单导入导出、批量添加
- **播放与媒体库**：兼容播放（ffmpeg 纯转封装 / 仅转音频 / 转 H.264）、音轨选择、字幕匹配与样式（延迟 / 字号 / 位置 / 背景）、本地字幕加载、片头片尾标记与自动跳过、快捷键、截图与片段录制、跨任务连播播放列表、继续观看；媒体库卡片与列表样式重做，新增剧集识别标签

### 变更

- **移除应用内自动更新**（electron-updater），改为「检查更新」查询并跳转 GitHub Releases
- 打包配置补全：NSIS 向导式安装（可改安装目录、创建快捷方式）、macOS `dmg` + `zip`、Linux `AppImage` + `deb`，产物上传到 GitHub Release
- CI 新增独立的端到端冒烟 job（Windows + Node 22）

### 修复

- **打包版无法启动**：主进程依赖 `fast-xml-parser` 被当作 external，而安装包内不含 `node_modules`
- MKV 内嵌封面（`mjpeg` 附件流）被误判为视频流，导致兼容播放决策错误
- 字幕匹配：繁体规则抢跑、过宽的前缀匹配、同一集数但不同剧被误判
- 冒烟脚本在缺少构建产物或环境不支持时**静默以退出码 0 结束**（会伪装成通过）
- 若干界面溢出问题（媒体库卡片宽度、提示条换行）

### 工程

- 新增无第三方依赖的端到端冒烟测试：CDP 驱动真实应用，验证「添加任务 → 真实下载 → 界面显示已完成」
- 引擎逻辑纯函数化（`aria-status` 等模块），单元测试从 75 例增至 244 例
