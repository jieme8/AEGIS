// HUD 信息面板（四角）。通用的 Hud 容器 + ChatToggle（对话开合入口）。
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
