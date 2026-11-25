import { describe, expect, it } from 'vitest'
import { hasSmartRule, matchesSmartCollection } from '../src/services/smart-collections'
import { arrangePersons, CLUSTER_THRESHOLD, emptyPeople, ingestFaces, mergePeople, mergePeopleMany, personFaces, personFilterKey, personIdOfFilterKey, personIdsOfPaths, personSummaries, personVideos, removePeopleMany, removePerson, renamePerson, sampleTimes, splitFaces, TARGET_SAMPLES, videoPersonMap, type DetectedFaceDraft, type PeopleData } from '../src/services/people'

function counter(prefix: string) {
  let n = 0
  return () => `${prefix}${++n}`
}

const draft = (vector: number[], t = 1, thumb = `thumb-${vector.join(',')}`): DetectedFaceDraft => ({ t, box: [0, 0, 100, 100], vector, thumb })
const video = (videoKey: string, now = 1000) => ({ videoKey, duration: 600, now })

describe('sampleTimes', () => {
  it('短片至少每 5 秒一帧，跳过片首 0 秒与片尾 1 秒内的帧', () => {
    expect(sampleTimes(0)).toEqual([])
    expect(sampleTimes(10)).toEqual([5])
    expect(sampleTimes(6)).toEqual([])
  })

  it('长片均匀抽样，单片不超过目标帧数', () => {
    const times = sampleTimes(600)
    expect(times[0]).toBe(10)
    expect(times.length).toBeLessThanOrEqual(TARGET_SAMPLES)
    expect(sampleTimes(7200).length).toBeLessThanOrEqual(TARGET_SAMPLES)
    expect(Math.max(...sampleTimes(600))).toBeLessThan(599)
  })
})

describe('ingestFaces 聚类', () => {
  it('同一方向的人脸归入同一人物，不同方向新建人物，并记录已分析视频', () => {
    const nextId = counter('id')
    let data = ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0, 0]), draft([0.99, 0.05, 0])], nextId)
    expect(data.people).toHaveLength(1)
    expect(data.faces).toHaveLength(2)
    data = ingestFaces(data, video('/b.mp4'), [draft([0, 1, 0])], nextId)
    expect(data.people).toHaveLength(2)
    expect(data.analyzed['/a.mp4']).toMatchObject({ duration: 600, samples: 2 })
    expect(data.analyzed['/b.mp4']).toMatchObject({ samples: 1 })
  })

  it('相似度恰在阈值两侧时分别并入与新建', () => {
    const nextId = counter('id')
    const cosOf = (cos: number) => [cos, Math.sqrt(1 - cos * cos), 0]
    const base = ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0, 0])], nextId)
    expect(ingestFaces(base, video('/b.mp4'), [draft(cosOf(CLUSTER_THRESHOLD + 0.05))], nextId).people).toHaveLength(1)
    expect(ingestFaces(base, video('/b.mp4'), [draft(cosOf(CLUSTER_THRESHOLD - 0.05))], nextId).people).toHaveLength(2)
  })

  it('同一视频中新出现的人物也能被后续人脸匹配', () => {
    const nextId = counter('id')
    const data = ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0]), draft([0, 1]), draft([0.98, 0.1])], nextId)
    expect(data.people).toHaveLength(2)
    expect(data.faces[2].personId).toBe(data.faces[0].personId)
  })
})

describe('人物操作', () => {
  function build(): PeopleData {
    const nextId = counter('id')
    return ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0, 0]), draft([0, 1, 0]), draft([0.99, 0.02, 0])], nextId)
  }

  it('重命名会去掉首尾空白', () => {
    const data = build()
    expect(renamePerson(data, data.people[0].id, '  小明 ').people[0].name).toBe('小明')
  })

  it('合并把人脸迁入目标人物并删除来源人物', () => {
    const data = build()
    const [first, second] = data.people
    const merged = mergePeople(data, second.id, first.id)
    expect(merged.people.map((person) => person.id)).toEqual([first.id])
    expect(merged.faces.every((face) => face.personId === first.id)).toBe(true)
    expect(mergePeople(data, first.id, first.id)).toBe(data)
  })

  it('合并时目标未命名则继承来源名称；两边都有名称时保留目标名称', () => {
    const data = build()
    const [first, second] = data.people
    const named = renamePerson(data, second.id, '小红')
    expect(mergePeople(named, second.id, first.id).people[0].name).toBe('小红')
    const both = renamePerson(renamePerson(data, first.id, '小明'), second.id, '小红')
    expect(mergePeople(both, second.id, first.id).people[0].name).toBe('小明')
  })

  it('拆分把选中人脸移到新人物；原人物被拆空时删除', () => {
    const data = build()
    const target = data.people[0]
    const faceIds = data.faces.filter((face) => face.personId === target.id).map((face) => face.id)
    const partial = splitFaces(data, [faceIds[0]], 'new-1', 2000)
    expect(partial.people.find((person) => person.id === target.id)).toBeDefined()
    expect(partial.faces.find((face) => face.id === faceIds[0])?.personId).toBe('new-1')
    const whole = splitFaces(data, faceIds, 'new-2', 2000)
    expect(whole.people.some((person) => person.id === target.id)).toBe(false)
    expect(splitFaces(data, [], 'x', 0)).toBe(data)
  })

  it('删除人物会同时删除其人脸', () => {
    const data = build()
    const removed = removePerson(data, data.people[0].id)
    expect(removed.people).toHaveLength(data.people.length - 1)
    expect(removed.faces.every((face) => face.personId !== data.people[0].id)).toBe(true)
  })
})

describe('视图与索引', () => {
  it('人物列表按人脸数降序，缩略图按与质心的相似度排序', () => {
    const nextId = counter('id')
    const data = ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0.3], 1, 'far'), draft([1, 0], 2, 'centre'), draft([1, -0.1], 3, 'other'), draft([0, 1], 4, 'solo')], nextId)
    const summaries = personSummaries(data)
    expect(summaries[0].faces).toBe(3)
    expect(summaries[0].thumbs[0]).toBe('centre')
    expect(summaries[0].thumbs).toHaveLength(3)
    expect(summaries[1]).toMatchObject({ faces: 1, videos: 1, thumbs: ['solo'] })
  })

  it('人物卡片的视频名只取文件名，并限制为 3 个', () => {
    const nextId = counter('id')
    const data = ingestFaces(emptyPeople(), video('/x/a.mp4'), [draft([1, 0])], nextId)
    const more = ingestFaces(data, video('/y/b.mp4'), [draft([1, 0])], nextId)
    const more2 = ingestFaces(more, video('/z/c.mp4'), [draft([1, 0])], nextId)
    const more3 = ingestFaces(more2, video('/w/d.mp4'), [draft([1, 0])], nextId)
    expect(personSummaries(more3)[0].topVideos).toEqual(['a.mp4', 'b.mp4', 'c.mp4'])
  })
})

describe('搜索、排序与批量操作', () => {
  const card = (id: string, name: string, faces: number, videos: number, createdAt: number) => ({ id, name, faces, videos, thumbs: [], topVideos: [], createdAt })
  const list = [card('a', '小明', 3, 1, 100), card('b', '', 10, 4, 300), card('c', 'alice', 5, 2, 200), card('d', '小红', 5, 3, 50)]

  it('名称搜索不区分大小写，去掉首尾空白', () => {
    expect(arrangePersons(list, '  ALI ', 'faces').map((person) => person.id)).toEqual(['c'])
    expect(arrangePersons(list, '', 'faces')).toHaveLength(4)
  })

  it('按人脸数、视频数、创建时间排序', () => {
    expect(arrangePersons(list, '', 'faces').map((person) => person.id)).toEqual(['b', 'c', 'd', 'a'])
    expect(arrangePersons(list, '', 'videos').map((person) => person.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(arrangePersons(list, '', 'recent').map((person) => person.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('按名称排序时已命名的在前，未命名的在最后', () => {
    const names = arrangePersons(list, '', 'name').map((person) => person.name)
    expect(names.slice(-1)).toEqual([''])
    expect(names.filter(Boolean)).toHaveLength(3)
  })

  it('批量合并把所有来源并入目标；批量删除同时移除其人脸', () => {
    const nextId = counter('id')
    const data = ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0, 0]), draft([0, 1, 0]), draft([0, 0, 1])], nextId)
    const [p1, p2, p3] = data.people
    const merged = mergePeopleMany(data, [p2.id, p3.id], p1.id)
    expect(merged.people.map((person) => person.id)).toEqual([p1.id])
    expect(merged.faces.every((face) => face.personId === p1.id)).toBe(true)
    const removed = removePeopleMany(data, [p1.id, p2.id])
    expect(removed.people.map((person) => person.id)).toEqual([p3.id])
    expect(removed.faces.map((face) => face.personId)).toEqual([p3.id])
  })

  it('视频→人物映射与人物→视频列表去重', () => {
    const nextId = counter('id')
    const data = ingestFaces(ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0]), draft([1, 0])], nextId), video('/b.mp4'), [draft([1, 0])], nextId)
    const personId = data.people[0].id
    expect(personVideos(data, personId)).toEqual(['/a.mp4', '/b.mp4'])
    expect(videoPersonMap(data)).toEqual({ '/a.mp4': [personId], '/b.mp4': [personId] })
  })

  it('人物人脸列表受数量上限约束，并按视频与时间排序', () => {
    const nextId = counter('id')
    const data = ingestFaces(emptyPeople(), video('/a.mp4'), [draft([1, 0], 30), draft([1, 0], 10), draft([1, 0], 20)], nextId)
    const faces = personFaces(data, data.people[0].id, 2)
    expect(faces.map((face) => face.t)).toEqual([10, 20])
  })
})

describe('人物筛选键与智能合集条件', () => {
  it('人物筛选键可往返，且与智能合集前缀不冲突', () => {
    expect(personIdOfFilterKey(personFilterKey('abc'))).toBe('abc')
    expect(personIdOfFilterKey('smart:abc')).toBeNull()
    expect(personIdOfFilterKey('all')).toBeNull()
  })

  it('条目的人物集合为其全部视频人物的去重并集', () => {
    const map = { '/a.mp4': ['p1', 'p2'], '/b.mp4': ['p2'], '/c.mp4': [] }
    expect(personIdsOfPaths(map, ['/a.mp4', '/b.mp4', '/missing.mp4'])).toEqual(['p1', 'p2'])
    expect(personIdsOfPaths(map, ['/c.mp4'])).toEqual([])
  })

  it('智能合集的「包含人物」条件参与 AND 过滤，并计入至少一条规则的校验', () => {
    const base = { watchPercent: 0, rating: 0, addedAt: 1, now: 2 }
    expect(hasSmartRule({ personId: 'p1' })).toBe(true)
    expect(matchesSmartCollection({ personId: 'p1' }, { ...base, personIds: ['p1', 'p2'] })).toBe(true)
    expect(matchesSmartCollection({ personId: 'p1' }, { ...base, personIds: ['p2'] })).toBe(false)
    expect(matchesSmartCollection({ personId: 'p1', kind: 'audio' }, { ...base, kind: 'video', personIds: ['p1'] })).toBe(false)
  })
})
