// 设置面板：聚合语言模型 / 生图模型 / 生图比例 三个切换器。
// 由任务栏「设置」按钮触发，ESC 或点击关闭按钮关闭。
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ProviderSwitcher } from "./ProviderSwitcher.jsx";
import { ImageProviderSwitcher } from "./ImageProviderSwitcher.jsx";
import { AspectSwitcher } from "./AspectSwitcher.jsx";

export function SettingsPanel({ open, onClose }) {
  const boxRef = useRef(null);

  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 标题栏拖动
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".sp-close")) return;
    const box = boxRef.current;
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const origLeft = box.offsetLeft, origTop = box.offsetTop;
    box.style.right = "auto";
    box.style.userSelect = "none";
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const maxLeft = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.max(0, Math.min(origLeft + dx, maxLeft)) + "px";
      box.style.top = Math.max(0, Math.min(origTop + dy, maxTop)) + "px";
    };
    const onUp = () => {
      box.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={boxRef}
      className="settings-panel"
      role="dialog"
      aria-label="设置面板"
      data-dev-id="settings-panel"
    >
      <div className="sp-head" onPointerDown={onHeadPointerDown}>
        <span className="sp-title">系统设置 · SETTINGS</span>
        <button className="sp-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="sp-body">
        <div className="sp-section" data-dev-id="sp-section-api">
          <div className="sp-label">语言模型</div>
          <ProviderSwitcher />
        </div>
        <div className="sp-section" data-dev-id="sp-section-img">
          <div className="sp-label">生图模型</div>
          <ImageProviderSwitcher />
        </div>
        <div className="sp-section" data-dev-id="sp-section-ratio">
          <div className="sp-label">生图比例</div>
          <AspectSwitcher />
        </div>
      </div>
    </div>,
    document.body
  );
}
