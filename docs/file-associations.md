# 文件关联与外部打开

BTViewer 支持三类「从系统直接打开」的入口：

1. **双击 `.torrent` / `.metalink` 文件**（或在文件管理器里「打开方式」选择 BTViewer）→ 进入任务解析流程
2. **点击网页上的磁力链接**（`magnet:` 协议）→ 进入任务解析流程
3. **双击 / 「打开方式」打开视频音频文件**（mp4、mkv、flac 等）→ 导入媒体库并直接播放（PotPlayer 式）

本篇记录这些关联在各平台如何声明、运行时链路如何分流，以及改完声明后怎样让它生效。

## 声明在哪一层

| 平台 | 机制 | 位置 |
| --- | --- | --- |
| Windows | 安装期文件关联 / 协议注册 | `electron-builder.yml` 的 `fileAssociations` + `protocols`（NSIS 安装向导写入注册表） |
| macOS | `Info.plist` 文档类型声明 | `mac.extendInfo` 的 `CFBundleDocumentTypes` + `UTImportedTypeDeclarations` |
| macOS 磁力协议 | URL Scheme | `mac.extendInfo` 的 `CFBundleURLTypes`（运行时另可用设置页开关 `setAsDefaultProtocolClient`） |
| Linux | 桌面 MIME 关联 | `fileAssociations` 生成 `.desktop` 条目（AppImage/deb） |

## macOS 的关键点

「打开方式」候选列表完全由 `Info.plist` 驱动，有两条铁律：

1. **`CFBundleDocumentTypes` 是唯一入口**，且 `LSHandlerRank: Default` 才会作为候选 app 被列出（`Viewer` 角色表示只查看不编辑）。
2. **系统没有内置 UTI 的容器必须先导入类型声明**。mkv、webm、wmv、flv、ogg、flac 这些扩展名 macOS 的 LaunchServices 不认识，只写 `CFBundleTypeExtensions` 在「打开方式」里经常不出现——必须先在 `UTImportedTypeDeclarations` 声明 UTI（`org.matroska.mkv`、`org.xiph.flac` 等逆向域名是社区通行约定），再在 `CFBundleDocumentTypes` 里用 `LSItemContentTypes` 引用，`CFBundleTypeExtensions` 作为兜底。

系统已内置、可直接引用的 UTI：`public.mpeg-4`（mp4）、`com.apple.m4v-video`（m4v）、`com.apple.quicktime-movie`（mov）、`public.avi`、`public.mpeg`（mpg/mpeg）、`public.mpeg-2-transport-stream`（ts/m2ts）、`public.mp3`、`public.mpeg-4-audio`（m4a）、`com.microsoft.waveform-audio`（wav）。

## 支持的扩展名与「三处同步」

媒体扩展名的唯一事实来源是主进程 `torrent-engine.ts` 的 `VIDEO_EXTENSIONS` / `AUDIO_EXTENSIONS`（`getFileType` 用它判定类型）。与之相关的位置有三处，**修改支持格式时必须一起改**：

| 位置 | 作用 |
| --- | --- |
| `electron/torrent-engine.ts` | 白名单本体；`getFileType` 据此判定 video/audio/other |
| `electron/launch-inputs.ts` 的 `MEDIA_FILE_RE` | 外部打开时收集媒体路径；**多认了会在导入时被 `getFileType` 拒绝**（报「不支持的本地媒体格式」） |
| `electron-builder.yml` 的 `CFBundleDocumentTypes` | 系统层面的文件关联声明 |

当前支持：视频 `mp4 / mkv / avi / mov / webm / flv / wmv / m4v / ts / rmvb`，音频 `mp3 / flac / wav / aac / ogg / m4a / wma`。

> 注意：wmv / flv / rmvb 这类容器 Chromium 本身解不了，能「导入」但起播时会提示用「兼容转码播放」（ffmpeg 生成可播副本）兜底。

## 运行时链路

```
双击文件 / Finder「打开方式」/ 命令行 / 二次启动
        │
        ├─ macOS: app.on('open-file')
        ├─ 二次启动: app.on('second-instance')
        └─ 磁力链接: app.on('open-url')
        │
        ▼
main.ts deliverInputs()
        │ collectLaunchInputs → 任务输入（磁力 / .torrent / .metalink）
        │ collectMediaLaunchInputs → 媒体路径（mp4/mkv/…）
        ▼
渲染层 App.tsx
        ├─ ipc.onOpenInput  → ipc.addTask（BT 进解析三选一，直链直接入队）
        └─ ipc.onOpenMedia  → importAndPlay（批量导入本地库 → 播第一个文件）
```

窗口未就绪时输入先在主进程排队（`pendingInputs` / `pendingMedia`），`flushPendingInputs` 就绪后补投。

## 让声明生效

文件关联写死在打包期的 `Info.plist` 里，因此：

1. **开发态（`npm run dev`）永远不会出现在「打开方式」里**——node_modules 里的 `electron.app` 是通用 Info.plist。调试关联必须用打包后的产物。
2. 重新 `npm run build` 出包并**安装**（拖进 /Applications）；如果装了新版本但列表里仍不出现，手动刷新 LaunchServices：

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/BTViewer.app
```

3. 右键菜单的「打开方式」列表偏短时，点「其他…」并把筛选切成「所有应用程序」。
4. `LSHandlerRank: Default` 表示「合适的默认处理程序」——不会抢占用户已设置的默认打开方式；想设为默认可在 Finder 的「显示简介 → 打开方式 → 全部更改」里手动指定。

## 常见问题

- **列表里没有 BTViewer**：先确认装的是声明之后的打包版本（`Info.plist` 里能搜到 `CFBundleDocumentTypes`），再 `lsregister -f` 刷新。
- **打开了但没反应**：看应用日志（设置 → 运行日志）里有没有 `launch` 标签的「收到外部输入」；没有说明扩展名没进 `MEDIA_FILE_RE`，有说明是渲染层导入被拒（白名单没同步）。
- **wmv/flv 打开后转圈**：容器不支持是预期行为，等「兼容转码播放」提示出现后一键转码。
