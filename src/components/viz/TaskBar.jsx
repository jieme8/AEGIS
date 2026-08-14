import { useEffect, useState } from "react";

// 底部任务栏：一个按钮 = 一个功能 / 一个组件入口。
// 想新增功能，直接往 TASKS 里加一项即可（id 需唯一）。
// 注：对话/MCP 的开关事件挂在 #openChat / #openMcp 上（由 ChatToggle/McpToggle
// 以隐藏触发器形式渲染），调试开关挂在 window.toggleDevMode 上，三者原按钮已从
// HUD / 页面移除，改由本任务栏统一承载。
const TASKS = [
  { id: "task-chat",    label: "对话", icon: "▸", onClick: () => document.getElementById("openChat")?.click() },
  { id: "task-mcp",     label: "MCP",  icon: "▣", onClick: () => document.getElementById("openMcp")?.click() },
  { id: "task-oil",     label: "油价", icon: "￥", onClick: () => flash(".oil-dock") },
  { id: "task-dev",     label: "调试", icon: "⚙", onClick: () => window.toggleDevMode?.(), selfActive: true },
];

// 目标元素均为 position:fixed（不在滚动流内），scrollIntoView 无效；
// 改为给目标加一个短暂高亮类，提示用户「定位到该组件」。
function flash(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.classList.remove("tb-flash");
  void el.offsetWidth; // 重启动画
  el.classList.add("tb-flash");
  setTimeout(() => el.classList.remove("tb-flash"), 900);
}

export function TaskBar({ active, onActivate }) {
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
          const isActive = t.selfActive ? devOn : active === t.id;
          return (
            <button
              key={t.id}
              id={t.id}
              type="button"
              className={"tb-btn" + (isActive ? " active" : "")}
              onClick={() => {
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
