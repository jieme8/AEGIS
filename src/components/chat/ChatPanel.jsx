import { useChatController } from "../../hooks/useChatController.js";
import { ChatTraceDrawer } from "./ChatTraceDrawer.jsx";

// 主对话窗口：页面核心交互区（默认开启），承载拖拽 / 缩放 / 对话逻辑。
// 子组件（头部 / 消息区 / 输入区 / 缩放手柄）拆分以便复用，行为逻辑统一由 useChatController 驱动。

const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function ChatHeader() {
  return (
    <div className="chat-header" id="chatDragHandle">
      <span className="led" />
      <span className="title">AI ASSISTANT</span>
      <button className="chat-clear" id="clearChat" type="button" aria-label="清空对话上下文" disabled>清空</button>
      <button className="chat-close" id="closeChat" type="button" aria-label="关闭">×</button>
    </div>
  );
}

export function ChatMessages() {
  return <div className="chat-messages" id="chatMessages" aria-live="polite" />;
}

export function ChatComposer() {
  return (
    <form className="chat-composer" id="chatComposer" autoComplete="off">
      <textarea
        className="chat-input"
        id="chatInput"
        rows={1}
        placeholder="输入消息… Enter 发送 / Shift+Enter 换行"
      />
      <button className="chat-send" id="chatSend" type="submit" aria-label="发送" disabled>
        <svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z" /></svg>
      </button>
    </form>
  );
}

export function ResizeHandles() {
  return (
    <>
      {RESIZE_DIRS.map((d) => (
        <span className={`resize-handle rh-${d}`} data-dir={d} key={d} />
      ))}
    </>
  );
}

export function ChatPanel() {
  const { trace, traceOpen, closeTrace } = useChatController();
  return (
    <>
      <aside className="chat-panel open" id="chatPanel" data-dev-id="chat-panel" aria-hidden="false">
        <ChatHeader />
        <ChatMessages />
        <ChatComposer />
        <ResizeHandles />
      </aside>
      {/* 独立浮层：经 Portal 挂到 body，不受聊天面板（含 backdrop-filter）限制，可在整页任意拖动 */}
      <ChatTraceDrawer trace={trace} open={traceOpen} onClose={closeTrace} />
    </>
  );
}
