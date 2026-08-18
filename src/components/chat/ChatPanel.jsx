import { useEffect, useState } from "react";
import { useChatController } from "../../hooks/useChatController.js";
import { TracePanels } from "./TracePanels.jsx";
import { TravelWizard } from "./TravelWizard.jsx";

// 主对话窗口：页面核心交互区（默认开启），承载拖拽 / 缩放 / 对话逻辑。
// 子组件（头部 / 消息区 / 输入区 / 缩放手柄）拆分以便复用，行为逻辑统一由 useChatController 驱动。

const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function ChatHeader({ traceOpen, onToggleTrace, imageOpen, onToggleImage }) {
  return (
    <div className="chat-header" id="chatDragHandle">
      <span className="led" />
      <span className="title">AI ASSISTANT</span>
      <button
        className={"chat-trace" + (traceOpen ? " active" : "")}
        id="toggleTrace"
        type="button"
        aria-label="显示/隐藏对话流"
        aria-pressed={traceOpen ? "true" : "false"}
        onClick={onToggleTrace}
      >对话流</button>
      <button
        className={"chat-image" + (imageOpen ? " active" : "")}
        id="toggleImage"
        type="button"
        aria-label="显示/隐藏配图窗口"
        aria-pressed={imageOpen ? "true" : "false"}
        onClick={onToggleImage}
      >配图</button>
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
        placeholder="输入消息… 输入 @ 唤起指令 · Enter 发送"
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

export function ChatPanel({ imageOpen, onToggleImage }) {
  const { trace, traceOpen, closeTrace, toggleTrace, openTrace, panelOpen, send, pendingAction, clearPendingAction } = useChatController();
  const [wizardOpen, setWizardOpen] = useState(false);

  // image-window 与对话流联动：打开配图窗口时，对话流浮层也一并显示
  useEffect(() => {
    if (imageOpen) openTrace();
  }, [imageOpen, openTrace]);

  // 用户点 ChatActionBar 上的 inline 行动按钮 → 打开 TravelWizard 并清掉 pendingAction（按钮被消费）
  const openWizardFromAction = () => {
    clearPendingAction();
    setWizardOpen(true);
  };

  return (
    <>
      <aside
        className={"chat-panel" + (panelOpen ? " open" : "")}
        id="chatPanel"
        data-dev-id="chat-panel"
        aria-hidden={panelOpen ? "false" : "true"}
      >
        <ChatHeader
          traceOpen={traceOpen}
          onToggleTrace={toggleTrace}
          imageOpen={imageOpen}
          onToggleImage={onToggleImage}
        />
        <ChatMessages />
        <ChatActionBar pendingAction={pendingAction} onOpenWizard={openWizardFromAction} />
        <ChatComposer />
        <ResizeHandles />
      </aside>
      {/* 独立浮层：经 Portal 挂到 body，不受聊天面板（含 backdrop-filter）限制，可在整页任意拖动 */}
      <TracePanels trace={trace} open={traceOpen} onClose={closeTrace} />
      <TravelWizard open={wizardOpen} onClose={() => setWizardOpen(false)} send={send} />
    </>
  );
}

/**
 * ChatMessages 下方、Composer 上方的"AI 行动项"区。
 * 仅在 AI 终态文本命中关键词（周末/出行方案/...）时才出现，由 pendingAction 驱动。
 * 用户点选 → 触发 onOpenWizard（打开 TravelWizard + 清掉 pendingAction），按钮消失；
 * 用户发下一条消息时 useChatController 也会自动清掉 pendingAction，对话继续后行动项不再骚扰。
 */
function ChatActionBar({ pendingAction, onOpenWizard }) {
  if (!pendingAction) return null;
  return (
    <div className="chat-action-bar" id="chatActionBar" data-dev-id="chat-action-bar">
      <button
        type="button"
        className="chat-action-btn"
        id="chatActionBtn"
        onClick={onOpenWizard}
      >
        <span className="chat-action-led" />
        <span className="chat-action-label">{pendingAction.label || "🧭 让我帮你规划周末出行"}</span>
        <span className="chat-action-arrow">→</span>
      </button>
    </div>
  );
}
