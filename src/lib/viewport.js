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

// 布局模式默认值：仅在小屏（≤1099，与既有响应式断点一致）自动走紧凑「stack」，
// 其余宽度默认「spread」（即原有多栏桌面布局，加载即所见即所得）；
// 用户随时可在 hud-bl 手动切换，切换后持久化覆盖此默认值。
export function defaultLayoutMode() {
  const narrow = typeof window !== "undefined" && window.innerWidth <= 1099;
  return narrow ? "stack" : "spread";
}