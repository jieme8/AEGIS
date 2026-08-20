// 设置面板：聚合语言模型 / 生图模型 / 生图比例 三个切换器。
// 由任务栏「设置」按钮触发。属于「居中弹层（带遮罩）」，非可移动窗口。
// 关闭方式：ESC / 点击遮罩 / 点击右上角关闭按钮。
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ProviderSwitcher } from "./ProviderSwitcher.jsx";
import { ImageProviderSwitcher } from "./ImageProviderSwitcher.jsx";
import { AspectSwitcher } from "./AspectSwitcher.jsx";

export function SettingsPanel({ open, onClose }) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="settings-backdrop"
      onClick={onClose}
      data-dev-id="settings-backdrop"
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置面板"
        data-dev-id="settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="settings-title">系统设置 · SETTINGS</span>
          <button
            className="settings-close"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-section" data-dev-id="sp-section-api">
          <div className="settings-section-title">语言模型</div>
          <div className="settings-section-body">
            <ProviderSwitcher />
          </div>
        </div>

        <div className="settings-section" data-dev-id="sp-section-img">
          <div className="settings-section-title">生图模型</div>
          <div className="settings-section-body">
            <ImageProviderSwitcher />
          </div>
        </div>

        <div className="settings-section" data-dev-id="sp-section-ratio">
          <div className="settings-section-title">生图比例</div>
          <div className="settings-section-body">
            <AspectSwitcher />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
