// HUD 信息面板（四角）。通用的 Hud 容器 + ChatToggle（对话开合入口）。
import { useEffect, useState } from "react";

export function Hud({ corner, id, children }) {
  return (
    <div className={`hud ${corner} panel`} data-dev-id={id}>
      {children}
    </div>
  );
}

export function ChatToggle() {
  return (
    <div className="chat-toggle" id="openChat" role="button" tabIndex={0}>
      ▸ AI 对话
    </div>
  );
}

export function McpToggle({ active, onClick }) {
  return (
    <div
      className={"mcp-toggle" + (active ? " active" : "")}
      id="openMcp"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      data-dev-id="mcp-toggle"
    >
      ▸ MCP 服务器
    </div>
  );
}

// 实时屏幕尺寸读数（视口 innerWidth×innerHeight），随窗口 resize 更新。
export function ScreenSizeBadge() {
  const [size, setSize] = useState(
    () => `${window.innerWidth}×${window.innerHeight}`
  );
  useEffect(() => {
    const onResize = () =>
      setSize(`${window.innerWidth}×${window.innerHeight}`);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <div>
      <span className="k">RES</span>{" "}
      <span className="v" id="hud-res">{size}</span>
    </div>
  );
}

// 排版布局切换开关：右上角紧凑图标按钮，在「宽屏多栏 / 紧凑单栏」间切换。
export function LayoutToggle({ mode, onToggle }) {
  const isSpread = mode === "spread";
  return (
    <button
      type="button"
      className={"layout-toggle" + (isSpread ? " spread" : " stack")}
      aria-label="切换排版布局"
      title={isSpread ? "宽屏多栏（点击切紧凑）" : "紧凑单栏（点击切宽屏）"}
      onClick={onToggle}
    >
      <span className="lt-icon">{isSpread ? "▭" : "▤"}</span>
    </button>
  );
}
