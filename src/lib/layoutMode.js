// 读取当前排版布局模式（spread / stack）。
// App 会把当前模式写到 document.body.dataset.layout，组件可直接读取，
// 无需层层透传 props。App 在切换时还会派发 "layoutmodechange" 事件。
export function getLayoutMode() {
  if (typeof document === "undefined") return "spread";
  return document.body.dataset.layout === "stack" ? "stack" : "spread";
}

export function isCompactLayout() {
  return getLayoutMode() === "stack";
}
