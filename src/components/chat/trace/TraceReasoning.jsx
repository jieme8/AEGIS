import { LoadingDots } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";

/**
 * 04 · 思考过程（独立桌面浮层）
 * 显示模型的 reasoning_content（思考链），默认展开。
 */
export function TraceReasoning({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const reply = t.reply || {};
  const streaming = t.status === "streaming" || t.status === "sending";
  const hasReasoning = !!(reply.reasoning && reply.reasoning.length);

  return (
    <FloatingPanel
      devId="trace-reasoning"
      title="对话流-04思考过程"
      defaultPos={{ x: 970, y: 80 }}
      width={320}
      open={open}
      onClose={onClose}
      index={index}
    >
      <details className="trace-section" open>
        <summary><span className="sec-idx">04</span> 思考过程</summary>
        <div className="trace-sec-body">
          {hasReasoning ? (
            <pre className="trace-code">{reply.reasoning}</pre>
          ) : streaming ? (
            <LoadingDots label="模型思考中…" />
          ) : (
            <div className="trace-empty">（无思考过程 / reasoning_content 为空）</div>
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
