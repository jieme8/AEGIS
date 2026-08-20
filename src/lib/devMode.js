// 编辑/调试模式（显示组件ID）的共享判定与订阅工具。
// 与 useDevOverlay 中 body.dev-mode 的切换保持一致：
//   开启 dev-mode（显示组件ID）时面板才允许拖动、显示坐标等；关闭时锁定。
// 通过 window 自定义事件 "devmodechange" 在模式切换时广播，避免各拖拽模块轮询。

export function isDevMode() {
  return typeof document !== "undefined" && document.body.classList.contains("dev-mode");
}

// 注册 dev-mode 变化回调：立即以当前状态触发一次，随后在模式切换时触发。
// 返回取消订阅函数（可在 effect cleanup 中调用）。
export function onDevModeChange(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = (e) => {
    const on = e && e.detail ? !!e.detail.on : isDevMode();
    cb(on);
  };
  // 立即以当前状态回调一次，保证初始绑定正确
  cb(isDevMode());
  window.addEventListener("devmodechange", handler);
  return () => window.removeEventListener("devmodechange", handler);
}
