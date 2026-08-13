// 背景层（非交互，置于最底层）：网格 / 透视光晕 / 暗角 / 扫描线 / 移动扫描条
// 类名、data-* 与原页面完全一致，保证视觉与可指代性不变。

export function BackgroundGrid() {
  return <div className="bg-grid" data-dev-id="fx-grid" data-dev-nolabel />;
}

export function BackgroundGlow() {
  // 注意：原页面中 bg-glow 未登记组件 ID（纯装饰氛围层）
  return <div className="bg-glow" />;
}

export function BackgroundVignette() {
  return <div className="bg-vignette" data-dev-id="fx-vignette" data-dev-nolabel />;
}

export function Scanlines() {
  return <div className="scanlines" data-dev-id="fx-scanlines" data-dev-nolabel />;
}

export function ScanBar() {
  return <div className="scanbar" data-dev-id="fx-scanbar" data-dev-nolabel />;
}
