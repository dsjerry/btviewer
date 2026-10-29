// 下载文件选择：aria2 的 select-file 是「下载选项」，只能在任务建立前或通过 changeOption 设置，
// 而且它控制的是「哪些文件参与下载」，不是「哪些文件显示在列表里」。
// 这里集中判定：用户勾选的路径 → aria2 文件序号，以及「播放」时至少要包含哪些文件。

export interface SelectableFileLike {
  index: string
  path: string
}

// 播放时要额外包含的伴随文件（同一目录下有相同文件名的字幕）：
// 边下边播时字幕文件通常在几 KB 级，顺手选中可以让字幕立刻可用，不额外增加等待。
export function companionSubtitleIndexes(
  files: Array<SelectableFileLike & { type?: string }>,
  playingPath: string
): string[] {
  if (!playingPath) return []
  const playing = files.find((file) => file.path === playingPath)
  if (!playing) return []
  const dir = playingPath.slice(0, playingPath.lastIndexOf('/') + 1)
  const stem = (playingPath.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase()
  const result: string[] = []
  for (const file of files) {
    if (file.type !== 'subtitle') continue
    if (file.index === playing.index) continue
    const isSameDir = file.path.slice(0, file.path.lastIndexOf('/') + 1) === dir
    const fileStem = (file.path.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase()
    // 只收同目录且文件名是播放文件前缀（覆盖 movie.mkv + movie.zh.srt 这类命名）
    if (isSameDir && (fileStem === stem || fileStem.startsWith(`${stem}.`))) result.push(file.index)
  }
  return result
}

// 最终 select-file 取值：显式选择 + 播放伴随文件，去重后按 aria2 要求的逗号分隔
export function mergeSelectFileIndexes(selected: string[], extra: string[] = []): string {
  return [...new Set([...selected, ...extra])].join(',')
}
