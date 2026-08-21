import { useEffect } from "react";
import { isDevMode, onDevModeChange } from "../lib/devMode.js";

// 编辑态（dev-mode）可拖拽的元素：形态切换按钮组 + 左下角落 HUD。
// 仅在显示组件ID时允许移动；松手后位置写入 localStorage，刷新后保持。
// 拖拽时把元素从 CSS 角/居中定位转换为 left/top 坐标定位，避免与 transform 冲突。
const MOVABLE = [
  { sel: ".form-switch", key: "fx-form-switch" },
  { sel: ".hud.bl", key: "hud-bl" },
  { sel: ".task-bar", key: "task-bar" },
];

const LS_PREFIX = "cyber-movable-";

// 这些交互控件不触发拖拽，让点击/复制等原生行为正常生效
const SKIP_SELECTOR = ".form-btn, .chat-toggle, .mcp-toggle, .dev-label, a, button";

export function useDraggableHud() {
  useEffect(() => {
    const items = MOVABLE
      .map((m) => ({ ...m, el: document.querySelector(m.sel) }))
      .filter((i) => i.el);
    if (!items.length) return;

    // 转为 left/top 坐标定位（清除角/居中依赖，含 translateX(-50%) 的居中 transform）
    function toCoordMode(it) {
      const r = it.el.getBoundingClientRect();
      it.el.style.left = r.left + "px";
      it.el.style.top = r.top + "px";
      it.el.style.right = "auto";
      it.el.style.bottom = "auto";
      it.el.style.transform = "none"; // text: form-switch / task-bar 用 translateX(-50%) 居中，需清除以免双重偏移
    }

    function apply(it, x, y) {
      const w = it.el.offsetWidth, h = it.el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      const nx = Math.max(0, Math.min(x, vw - w));
      const ny = Math.max(0, Math.min(y, vh - h));
      it.el.style.left = nx + "px";
      it.el.style.top = ny + "px";
    }

    function load(it) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + it.key);
        if (raw) {
          const o = JSON.parse(raw);
          // 仅接受 v2 格式；旧版坐标可能含 resize 发散 bug 产生的脏值，
          // 直接作废清除，让元素回到 CSS 定位（任务栏居中）以免错位/重叠。
          if (o && typeof o.x === "number" && o.v === 2) return o;
          localStorage.removeItem(LS_PREFIX + it.key);
        }
      } catch (e) { localStorage.removeItem(LS_PREFIX + it.key); }
      return null;
    }
    function save(it) {
      try {
        const r = it.el.getBoundingClientRect();
        localStorage.setItem(LS_PREFIX + it.key, JSON.stringify({ x: r.left, y: r.top, v: 2 }));
      } catch (e) { /* ignore */ }
    }

    // 恢复已保存位置（若曾拖拽过）
    items.forEach((it) => {
      const s = load(it);
      if (s) { toCoordMode(it); apply(it, s.x, s.y); }
    });

    // ---- 拖拽控制 ----
    const dragState = new Map(); // it -> { px, py, ox, oy }

    function onDown(e) {
      const it = items.find((i) => i.el === e.currentTarget);
      if (!it) return;
      if (!isDevMode()) return;
      if (e.button !== undefined && e.button !== 0) return;       // 仅左键
      if (e.target.closest && e.target.closest(SKIP_SELECTOR)) return; // 交互控件跳过
      toCoordMode(it);
      const r = it.el.getBoundingClientRect();
      dragState.set(it, { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top });
      it.el.classList.add("dragging");
      try { it.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
      e.preventDefault();
    }
    function onMove(e) {
      dragState.forEach((st, it) => {
        apply(it, st.ox + (e.clientX - st.px), st.oy + (e.clientY - st.py));
      });
    }
    function onUp() {
      dragState.forEach((_st, it) => { it.el.classList.remove("dragging"); save(it); });
      dragState.clear();
      window.removeEventListener("pointermove", onMove);
    }

    items.forEach((it) => it.el.addEventListener("pointerdown", onDown));

    // 视口变化重新约束，防止越界。
    // 仅作用于已被拖成 left/top 坐标定位（存在内联坐标）的元素；
    // 仍由 CSS 定位（如 task-bar 居中 / form-switch 居中）的元素绝不写内联样式，
    // 交给响应式 CSS 断点收敛，避免 resize 时把居中元素越写越偏（发散偏移）。
    function onResize() {
      items.forEach((it) => {
        if (!it.el.style.left) return;
        const r = it.el.getBoundingClientRect();
        apply(it, r.left, r.top);
      });
    }
    window.addEventListener("resize", onResize);

    // dev-mode 切换：仅编辑态允许拖拽，并切换 .draggable 提示样式
    function syncMode(on) {
      items.forEach((it) => it.el.classList.toggle("draggable", !!on));
    }
    const unsub = onDevModeChange(syncMode);

    return () => {
      items.forEach((it) => {
        it.el.removeEventListener("pointerdown", onDown);
        it.el.classList.remove("draggable", "dragging");
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      if (unsub) unsub();
    };
  }, []);
}
