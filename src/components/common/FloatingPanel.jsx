import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 通用可拖拽浮层（Portal 挂到 document.body，视口级定位）。
 * 用于把「模型对话过程（对话流）」拆成的独立小块分别放在桌面上，
 * 每个浮层自带标题栏、关闭按钮、data-dev-id 组件 ID 标注，且可自由拖动。
 * index 用于错落入场动画；total 用于收起时的反向级联（最后一个先收）。
 */

// 与 CSS 关键帧时长对齐（毫秒），用于决定卸载时机
const ENTER_DUR = 380;
const EXIT_DUR = 320;
const ENTER_STAGGER = 110;   // 入场级联：每个面板比前一个晚 110ms
const EXIT_STAGGER = 70;     // 收起反向级联：index 越大越早收起

export function FloatingPanel({
  devId,
  title,
  defaultPos = { x: 480, y: 16 },
  width = 320,
  height,
  open,
  onClose,
  headClass = "",
  headExtra,
  index = 0,
  total = 1,
  children,
}) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [render, setRender] = useState(open);   // 是否真正在 DOM 中（关闭动画期间保持 true）

  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    // open=false：若仍在 DOM，启动收起动画，动画结束后卸载
    if (render) {
      const delay = (total - 1 - index) * EXIT_STAGGER;
      const t = setTimeout(
        () => setRender(false),
        EXIT_DUR + delay + 40
      );
      return () => clearTimeout(t);
    }
  }, [open]); // 仅响应 open 变化；index/total 在单个面板生命周期内稳定

  if (!render) return null;

  // 阶段：open 为真 → 入场；已挂载但 open 为假 → 收起
  const phase = open ? "enter" : "exit";
  const animDelay = (open ? index : total - 1 - index) * (open ? ENTER_STAGGER : EXIT_STAGGER);

    const onHeadPointerDown = (e) => {
    if (e.target.closest("button")) return;   // 标题栏上的按钮（关闭 / 自定义）不触发拖拽
    const box = ref.current;
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const origLeft = box.offsetLeft, origTop = box.offsetTop;
    box.style.right = "auto";
    setDragging(true);
    box.style.userSelect = "none";

    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const maxL = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxT = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.max(0, Math.min(origLeft + dx, maxL)) + "px";
      box.style.top = Math.max(0, Math.min(origTop + dy, maxT)) + "px";
    };
    const onUp = () => {
      setDragging(false);
      box.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  return createPortal(
    <div
      ref={ref}
      className={`float-panel ${phase}${dragging ? " dragging" : ""}`}
      style={{
        left: defaultPos.x + "px",
        top: defaultPos.y + "px",
        width: width + "px",
        height: height ? height + "px" : undefined,
        // 错落延迟：入场按 index、收起按反向 index；配合 CSS 的 backwards/forwards 填充
        animationDelay: (animDelay / 1000).toFixed(2) + "s",
      }}
      data-dev-id={devId}
    >
      <div className={`float-head${headClass ? " " + headClass : ""}`} onPointerDown={onHeadPointerDown}>
        <span className="float-title">{title}</span>
        {headExtra}
        <button className="float-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      <div className="float-body">{children}</div>
      {/* 组件 ID 标签（dev 模式显示，点击复制）。
          四个分段（z-index / ID / 坐标 / 尺寸）全部由 JSX 持有，
          内容交由 useDevOverlay 通过 data-* 属性注入，避免面板 re-render
          时 React 把坐标/尺寸文本冲掉（改用 ::after 读取属性渲染）。 */}
      <span className="dev-label" data-copy-id={devId} onClick={() => copyId(devId)}>
        <span className="dl-z" />
        <span className="dl-id">{devId}</span>
        <span className="dl-coord" />
        <span className="dl-size" />
      </span>
    </div>,
    document.body
  );
}

// 与 DevOverlay 复用同一 toast 元素
function copyId(id) {
  const done = () => {
    const toast = document.getElementById("devToast");
    if (toast) {
      toast.textContent = "已复制 ✓ " + id;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1300);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(done, done);
  } else {
    done();
  }
}
