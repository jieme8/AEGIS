import { useEffect, useState } from "react";

// 底部任务栏：一个按钮 = 一个功能 / 一个组件入口。
// 想新增功能，直接往 TASKS 里加一项即可（id 需唯一）。
// 注：对话/MCP 的开关事件挂在 #openChat / #openMcp 上（由 ChatToggle/McpToggle
// 以隐藏触发器形式渲染），调试开关挂在 window.toggleDevMode 上，三者原按钮已从
// HUD / 页面移除，改由本任务栏统一承载。
const TASKS = [
  { id: "task-chat",    label: "对话", icon: "▸", onClick: () => document.getElementById("openChat")?.click(), selfActive: true },
  { id: "task-mcp",     label: "MCP",  icon: "▣", onClick: () => document.getElementById("openMcp")?.click(), selfActive: true },
  { id: "task-map",     label: "地图", icon: "◉", selfActive: false },
  { id: "task-dev",     label: "调试", icon: "⚙", onClick: () => window.toggleDevMode?.(), selfActive: true },
  { id: "task-features", label: "清单", icon: "≡", selfActive: false },
  { id: "task-flow",     label: "流程", icon: "⇄", selfActive: false },
  { id: "task-settings", label: "设置", icon: "◫", selfActive: true },
];

export function TaskBar({ active, onActivate, onToggleMap, mapOpen, onToggleFeatures, featuresOpen, onToggleFlow, flowOpen, onOpenSettings, settingsOpen }) {
  // 调试按钮反映真实 dev-mode 状态（其他按钮沿用选中态）
  const [devOn, setDevOn] = useState(false);
  useEffect(() => {
    const sync = (on) => setDevOn(Boolean(on));
    sync(document.body.classList.contains("dev-mode"));
    const onMode = (e) => sync(e.detail?.on);
    window.addEventListener("devmodechange", onMode);
    return () => window.removeEventListener("devmodechange", onMode);
  }, []);

  return (
    <div className="task-bar panel" data-dev-id="task-bar">
      <span className="tb-label">TASK</span>
      <div className="tb-items">
        {TASKS.map((t, i) => {
          const isActive = t.id === "task-settings"
            ? settingsOpen
            : t.id === "task-map"
              ? mapOpen
              : t.id === "task-features"
                ? featuresOpen
                : t.id === "task-flow"
                  ? flowOpen
                  : (t.selfActive ? devOn : active === t.id);
          return (
            <button
              key={t.id}
              id={t.id}
              type="button"
              className={"tb-btn" + (isActive ? " active" : "")}
              onClick={() => {
                if (t.id === "task-settings") { onOpenSettings?.(); return; }
                if (t.id === "task-map") { onToggleMap?.(); return; }
                if (t.id === "task-features") { onToggleFeatures?.(); return; }
                if (t.id === "task-flow") { onToggleFlow?.(); return; }
                t.onClick?.();
                if (!t.selfActive) onActivate?.(active === t.id ? null : t.id);
              }}
            >
              <span className="tb-icon">{t.icon}</span>
              <span className="tb-text">{t.label}</span>
              <span className="tb-idx">{String(i + 1).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
