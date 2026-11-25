// 尾部防抖：连续触发时只在最后一次触发后静默 ms 毫秒执行一次（用于合并高频的入库广播）
export function trailingDebounce(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    call: () => {
      clearTimeout(timer)
      timer = setTimeout(fn, ms)
    },
    cancel: () => clearTimeout(timer)
  }
}
