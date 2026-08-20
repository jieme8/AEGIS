// 页面首次打开时的视口宽度快照，之后不再随窗口 resize 变化。
// 逻辑：首次打开时若宽度 ≤ 1600，判定为紧凑布局（compact），
// 用于默认隐藏部分浮层 + 收敛默认位置，避免 5 个浮层在小屏上互相遮挡。
let cached;
export function isCompactViewport() {
  if (cached === undefined) {
    cached = typeof window !== "undefined" && window.innerWidth <= 1600;
  }
  return cached;
}