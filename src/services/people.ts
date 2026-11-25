// 人物合集的数据模型与纯逻辑（主进程与渲染层共用，不碰 DOM 与模型，可穷举单测）。
// 每张检测到的人脸在入库时即归入一个人物：与已有人物质心的余弦相似度达到阈值则并入，否则新建人物。
import { cosine, l2Normalize } from './face-embed'

// 聚类阈值：人脸与人物质心的余弦相似度下限。OpenCV 对「两张脸是否同一人」的默认阈值为 0.363，
// 这里用于质心归并，取略高的 0.4 以减少误合并；实际效果需用真实片源标定后再调整。
export const CLUSTER_THRESHOLD = 0.4
// 抽帧：至少每 5 秒一帧，长片按时长均匀抽样，单片最多约 60 帧
export const MIN_SAMPLE_INTERVAL = 5
export const TARGET_SAMPLES = 60
// 单人物详情最多列出的人脸数（缩略图较多，超出部分不展示）
export const PERSON_FACE_LIMIT = 120
// SFace 特征维度（128 维）；缩略图为对齐后的 112×112 JPEG data URL，体积上限用于校验渲染层提交的数据
export const FACE_DIM = 128
export const MAX_THUMB_CHARS = 60_000

export type FaceBox = [x: number, y: number, width: number, height: number]

export interface FaceRecord {
  id: string
  videoKey: string
  t: number
  box: FaceBox
  vector: number[]
  thumb: string
  personId: string
}

export interface PersonRecord { id: string; name: string; createdAt: number }

export interface AnalyzedRecord { duration: number; samples: number; analyzedAt: number }

export interface PeopleData {
  version: 1
  people: PersonRecord[]
  faces: FaceRecord[]
  analyzed: Record<string, AnalyzedRecord>
}

export interface DetectedFaceDraft { t: number; box: FaceBox; vector: number[]; thumb: string }

// 人物卡片：thumbs 为按质心相似度排序的代表人脸（最多 THUMB_STRIP 张），topVideos 为出现过的视频文件名（最多 3 个）
export interface PersonSummary { id: string; name: string; faces: number; videos: number; thumbs: string[]; topVideos: string[]; createdAt: number }
export const THUMB_STRIP = 4
export const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path

export interface FaceView { id: string; videoKey: string; t: number; thumb: string }

export const emptyPeople = (): PeopleData => ({ version: 1, people: [], faces: [], analyzed: {} })

export function sampleTimes(duration: number): number[] {
  if (!(duration > 0)) return []
  const interval = Math.max(MIN_SAMPLE_INTERVAL, duration / TARGET_SAMPLES)
  const times: number[] = []
  for (let t = interval; t < duration - 1; t += interval) times.push(Math.round(t * 10) / 10)
  return times
}

function accumulate(sums: Map<string, number[]>, counts: Map<string, number>, personId: string, vector: ArrayLike<number>) {
  const sum = sums.get(personId) ?? new Array<number>(vector.length).fill(0)
  for (let i = 0; i < vector.length; i++) sum[i] += vector[i]
  sums.set(personId, sum)
  counts.set(personId, (counts.get(personId) ?? 0) + 1)
}

// 入库一段视频的检测结果：逐张与当前人物质心比较（质心 = 成员向量之和，余弦对缩放不敏感，无需除以人数）
export function ingestFaces(
  data: PeopleData,
  video: { videoKey: string; duration: number; now: number },
  drafts: DetectedFaceDraft[],
  newId: () => string,
  threshold = CLUSTER_THRESHOLD
): PeopleData {
  const people = [...data.people]
  const faces = [...data.faces]
  const sums = new Map<string, number[]>()
  const counts = new Map<string, number>()
  for (const face of data.faces) accumulate(sums, counts, face.personId, face.vector)
  for (const draft of drafts) {
    const vector = l2Normalize(draft.vector)
    let bestId: string | null = null
    let bestScore = -Infinity
    for (const [personId, sum] of sums) {
      const score = cosine(sum, vector)
      if (score > bestScore) { bestScore = score; bestId = personId }
    }
    let personId = bestId !== null && bestScore >= threshold ? bestId : null
    if (personId === null) {
      personId = newId()
      people.push({ id: personId, name: '', createdAt: video.now })
    }
    accumulate(sums, counts, personId, vector)
    faces.push({ id: newId(), videoKey: video.videoKey, t: draft.t, box: draft.box, vector, thumb: draft.thumb, personId })
  }
  const analyzed = { ...data.analyzed, [video.videoKey]: { duration: video.duration, samples: drafts.length, analyzedAt: video.now } }
  return { ...data, people, faces, analyzed }
}

export function renamePerson(data: PeopleData, personId: string, name: string): PeopleData {
  return { ...data, people: data.people.map((person) => (person.id === personId ? { ...person, name: name.trim() } : person)) }
}

// 把 fromId 的全部人脸并入 toId，并删除 fromId。目标未命名而来源已命名时继承来源的名称，避免手动命名被丢弃；
// 两边都有名称时以目标为准
export function mergePeople(data: PeopleData, fromId: string, toId: string): PeopleData {
  const from = data.people.find((person) => person.id === fromId)
  if (fromId === toId || !from || !data.people.some((person) => person.id === toId)) return data
  return {
    ...data,
    people: data.people
      .filter((person) => person.id !== fromId)
      .map((person) => (person.id === toId && !person.name && from.name ? { ...person, name: from.name } : person)),
    faces: data.faces.map((face) => (face.personId === fromId ? { ...face, personId: toId } : face))
  }
}

// 把选中的人脸拆到一个新人物；原人物若被拆空则删除
export function splitFaces(data: PeopleData, faceIds: string[], newPersonId: string, now: number): PeopleData {
  const selected = new Set(faceIds)
  const moved = data.faces.filter((face) => selected.has(face.id))
  if (moved.length === 0) return data
  const sourceIds = new Set(moved.map((face) => face.personId))
  const faces = data.faces.map((face) => (selected.has(face.id) ? { ...face, personId: newPersonId } : face))
  const remaining = new Set(faces.map((face) => face.personId))
  const people = data.people.filter((person) => !sourceIds.has(person.id) || remaining.has(person.id))
  return { ...data, people: [...people, { id: newPersonId, name: '', createdAt: now }], faces }
}

export function removePerson(data: PeopleData, personId: string): PeopleData {
  return {
    ...data,
    people: data.people.filter((person) => person.id !== personId),
    faces: data.faces.filter((face) => face.personId !== personId)
  }
}

export function videoPersonMap(data: PeopleData): Record<string, string[]> {
  const map: Record<string, Set<string>> = {}
  for (const face of data.faces) (map[face.videoKey] ??= new Set()).add(face.personId)
  return Object.fromEntries(Object.entries(map).map(([key, set]) => [key, [...set]]))
}

// 人物列表：人脸数、视频数；缩略图按与质心的相似度排序（最像「这个人」的在前）
export function personSummaries(data: PeopleData): PersonSummary[] {
  // 先按人物一次性分组（O(人脸数)），避免对每个人物全量过滤（原先为 O(人物数 × 人脸数)）
  const byPerson = new Map<string, FaceRecord[]>()
  for (const face of data.faces) {
    const bucket = byPerson.get(face.personId)
    if (bucket) bucket.push(face)
    else byPerson.set(face.personId, [face])
  }
  return data.people.map((person) => {
    const members = byPerson.get(person.id) ?? []
    const sum = members.reduce<number[]>((acc, face) => (acc.length ? acc.map((value, i) => value + face.vector[i]) : [...face.vector]), [])
    const ranked = members
      .map((face) => ({ thumb: face.thumb, score: cosine(sum, face.vector) }))
      .sort((a, b) => b.score - a.score)
    const videoKeys = [...new Set(members.map((face) => face.videoKey))]
    return {
      id: person.id,
      name: person.name,
      faces: members.length,
      videos: videoKeys.length,
      thumbs: ranked.slice(0, THUMB_STRIP).map((item) => item.thumb),
      topVideos: videoKeys.slice(0, 3).map(fileNameOf),
      createdAt: person.createdAt
    }
  }).sort((a, b) => b.faces - a.faces)
}

export function personFaces(data: PeopleData, personId: string, limit = PERSON_FACE_LIMIT): FaceView[] {
  return data.faces
    .filter((face) => face.personId === personId)
    .sort((a, b) => (a.videoKey === b.videoKey ? a.t - b.t : a.videoKey < b.videoKey ? -1 : 1))
    .slice(0, limit)
    .map((face) => ({ id: face.id, videoKey: face.videoKey, t: face.t, thumb: face.thumb }))
}

export function personVideos(data: PeopleData, personId: string): string[] {
  return [...new Set(data.faces.filter((face) => face.personId === personId).map((face) => face.videoKey))]
}

// 库视图里的人物筛选项沿用「虚拟合集」的选中键约定（前缀与智能合集 smart: 区分）
const PERSON_PREFIX = 'person:'
export const personFilterKey = (personId: string) => `${PERSON_PREFIX}${personId}`
export const personIdOfFilterKey = (key: string): string | null => (key.startsWith(PERSON_PREFIX) ? key.slice(PERSON_PREFIX.length) : null)

// 一组视频路径涉及的人物（去重）：库条目的人物集合 = 其所有视频的人物并集
export function personIdsOfPaths(videoPersons: Record<string, string[]>, paths: string[]): string[] {
  return [...new Set(paths.flatMap((path) => videoPersons[path] ?? []))]
}

export type PersonSort = 'faces' | 'videos' | 'name' | 'recent'
export const PERSON_SORTS: PersonSort[] = ['faces', 'videos', 'name', 'recent']

// 人物页的搜索与排序（纯函数）：名称不区分大小写的子串匹配；未命名的人物在按名称排序时排在最后
export function arrangePersons(list: PersonSummary[], query: string, sort: PersonSort): PersonSummary[] {
  const text = query.trim().toLowerCase()
  const matched = text ? list.filter((person) => person.name.toLowerCase().includes(text)) : list.slice()
  const byName = (a: PersonSummary, b: PersonSummary) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  }
  const comparers: Record<PersonSort, (a: PersonSummary, b: PersonSummary) => number> = {
    faces: (a, b) => b.faces - a.faces,
    videos: (a, b) => b.videos - a.videos || b.faces - a.faces,
    name: byName,
    recent: (a, b) => b.createdAt - a.createdAt
  }
  return matched.sort(comparers[sort])
}

// 批量合并：按顺序把每个来源并入目标（与单个合并同样的名称继承规则）
export function mergePeopleMany(data: PeopleData, fromIds: string[], toId: string): PeopleData {
  return fromIds.reduce((current, fromId) => mergePeople(current, fromId, toId), data)
}

export function removePeopleMany(data: PeopleData, personIds: string[]): PeopleData {
  const doomed = new Set(personIds)
  return {
    ...data,
    people: data.people.filter((person) => !doomed.has(person.id)),
    faces: data.faces.filter((face) => !doomed.has(face.personId))
  }
}
