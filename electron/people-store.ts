// 人物合集的主进程侧：people.json 持久化（原子写入）、候选视频挑选（只取已下载完成的视频）、
// ffmpeg 探测时长与单帧抽取。人脸检测与识别在渲染层完成（MediaPipe / ONNX Runtime Web），结果经 submitAnalysis 入库。
import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { detectBinary } from './ytdlp-engine'
import { writeJsonAtomic } from './storage'
import { listLocalMedia } from './local-media'
import { torrentEngine } from './torrent-engine'
import {
  emptyPeople, FACE_DIM, ingestFaces, MAX_THUMB_CHARS, mergePeopleMany, personFaces, personSummaries, removePeopleMany, removePerson, renamePerson, splitFaces, videoPersonMap,
  type DetectedFaceDraft, type PeopleData
} from '../src/services/people'

const peopleFile = () => join(app.getPath('userData'), 'people.json')
let cache: PeopleData | null = null
// 本次运行中探测或抽帧失败的视频：记下来不反复重试，避免后台循环空转
const failedKeys = new Set<string>()

function load(): PeopleData {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(peopleFile(), 'utf8')) as PeopleData
    cache = parsed && parsed.version === 1 ? parsed : emptyPeople()
  } catch { cache = emptyPeople() }
  return cache
}

function save(data: PeopleData) {
  cache = data
  writeJsonAtomic(peopleFile(), data)
}

export function peopleSummary() {
  const data = load()
  return { people: personSummaries(data), analyzed: Object.keys(data.analyzed).length }
}

export const peopleFacesOf = (personId: string) => personFaces(load(), personId)
export const peopleVideoMap = () => videoPersonMap(load())

export function renamePersonById(personId: string, name: string) {
  save(renamePerson(load(), personId, name))
}

export function mergePersonsInto(fromIds: string[], toId: string) {
  save(mergePeopleMany(load(), fromIds, toId))
}

export function removePersonsById(personIds: string[]) {
  save(removePeopleMany(load(), personIds))
}

// 拆分：新人物 ID 在调用前生成，返回给渲染层以便选中新人物
export function splitPersonFaces(faceIds: string[]): string {
  const newId = randomUUID()
  save(splitFaces(load(), faceIds, newId, Date.now()))
  return newId
}

export function removePersonById(personId: string) {
  save(removePerson(load(), personId))
}

export function clearPeopleData() {
  failedKeys.clear()
  save(emptyPeople())
}

// 只分析「已下载完成」的视频：BT/直链任务的文件需完整落盘，本地引用需存在且未离线
async function completedVideoPaths(): Promise<string[]> {
  const paths = new Set<string>()
  for (const status of await torrentEngine.getAllStatuses()) {
    for (const file of status.files) {
      if (file.type === 'video' && file.size > 0 && file.completed >= file.size) paths.add(file.path)
    }
  }
  for (const entry of listLocalMedia()) {
    if (entry.type === 'video' && !entry.missing) paths.add(entry.path)
  }
  return [...paths]
}

async function resolveFfmpeg(): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  const custom = process.env.FFMPEG_PATH
  const ffmpeg = custom && existsSync(custom) ? custom : await detectBinary(undefined, 'ffmpeg', join(app.getPath('userData'), 'bin'))
  if (!ffmpeg) return null
  const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  return existsSync(ffprobe) ? { ffmpeg, ffprobe } : null
}

function run(binary: string, args: string[], timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(binary, args, { encoding: 'buffer', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs }, (error, stdout) => {
      resolve(error ? null : stdout)
    })
  })
}

async function probeDuration(ffprobe: string, path: string): Promise<number> {
  const out = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], 20000)
  const seconds = Number.parseFloat(out?.toString('utf8').trim() ?? '')
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

// 取下一个待分析视频及其时长；没有可分析的视频时返回 null
export async function nextAnalysisJob(): Promise<{ key: string; path: string; duration: number } | null> {
  const binaries = await resolveFfmpeg()
  if (!binaries) return null
  const data = load()
  for (const path of await completedVideoPaths()) {
    if (data.analyzed[path] || failedKeys.has(path)) continue
    const duration = await probeDuration(binaries.ffprobe, path)
    if (!duration) { failedKeys.add(path); continue }
    return { key: path, path, duration }
  }
  return null
}

// 在 t 秒处抽一帧，宽度不超过 960px，JPEG 字节；只允许抽取当前已完成的视频
export async function extractAnalysisFrame(path: string, t: number): Promise<Uint8Array | null> {
  if (!(await completedVideoPaths()).includes(path)) return null
  const binaries = await resolveFfmpeg()
  if (!binaries) return null
  return run(binaries.ffmpeg, ['-v', 'error', '-ss', String(t), '-i', path, '-frames:v', '1', '-vf', "scale='min(960,iw)':-2", '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', 'pipe:1'], 30000)
}

// 入库一段视频的分析结果；渲染层提交的数据先做形状校验，不合格的人脸直接丢弃
export function submitAnalysis(key: string, duration: number, drafts: DetectedFaceDraft[]) {
  const valid = drafts.filter((draft) => Array.isArray(draft.vector) && draft.vector.length === FACE_DIM
    && Array.isArray(draft.box) && draft.box.length === 4 && typeof draft.thumb === 'string' && draft.thumb.length <= MAX_THUMB_CHARS)
  save(ingestFaces(load(), { videoKey: key, duration, now: Date.now() }, valid, () => randomUUID()))
}
