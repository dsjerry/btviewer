# 安装与打包

[English](./installation.en.md) · [下载发布版本](https://github.com/dsjerry/btviewer/releases)

## 发布安装包

- Windows：NSIS 安装包
- Linux：AppImage / deb
- macOS：当前提供 Apple 芯片（arm64）构建；Intel 用户需从源码打包并准备 Intel 版 aria2c

### 首次打开 macOS 版本

目前 macOS 包未使用 Apple Developer ID 证书签名。首次打开时按住 Control 点击 `BTViewer.app`，选择「打开」，再确认一次。

若仍提示应用已损坏，可在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/BTViewer.app
```

未使用 Developer ID 签名时，macOS 不允许应用注册开机自启；可在「系统设置 → 通用 → 登录项」中手动添加。

## 从源码打包

```bash
npm run package:win
npm run package:mac
npm run package:linux
```

常用目标：`package:mac:arm64`、`package:mac:x64` 和 `package:mac:universal`。Universal 构建需要同时准备 `mac-x64` 与 `mac-arm64` 的 aria2c。

`electron-builder.yml` 按平台与架构复制 `resources/aria2` 中对应目录：

| 平台 | 目录 |
| --- | --- |
| Windows | `win-x64` 或 `win-arm64` |
| macOS | `mac-arm64` 或 `mac-x64` |
| Linux | `linux-x64` 或 `linux-arm64` |

Linux 的 aria2c 动态库需与二进制放在同一目录，或由目标系统提供。内置媒体工具位于 `resources/media/<os>-<arch>/`，应用启动时会安装到用户数据目录。

### macOS 内置二进制维护说明

- aria2c 基于 aria2 1.37.0、静态 c-ares 1.34.9 与 AppleTLS 构建，启用 BitTorrent；SHA-256：`ca68feea…cbba51`。
- ffmpeg / ffprobe 7.1.1 启用 libx264 与 VideoToolbox；SHA-256：`aac9f523…6cba6c` / `2c946f48…00a121`。
- 这些二进制使用 `MACOSX_DEPLOYMENT_TARGET=11.0` 构建。修改或更新时需保持最低系统版本；CI 会检查 Mach-O `minos`。
- Intel Mac 可使用官方 `aria2-1.35.0-osx-darwin` 二进制作为 `mac-x64/aria2c`。

## macOS 签名

| 构建配置 | 结果 |
| --- | --- |
| 无签名 secrets | CI 使用 ad-hoc 签名；首次打开需手动放行 |
| `CSC_LINK` + `CSC_KEY_PASSWORD` | Developer ID 签名；无公证时仍可能显示 Gatekeeper 提示 |
| 再配置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | 签名并公证，可正常双击打开 |

发布流程由 GitHub Actions 手动触发；CI 工作流负责多平台验证与构建。
