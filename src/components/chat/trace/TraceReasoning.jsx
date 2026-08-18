import { useEffect, useRef } from "react";
import { LoadingDots, useContentPulse, TraceIdle } from "./shared.jsx";
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
  const codeRef = useRef(null);
  // 仅在「思考内容」真正变化且有内容时，标题栏才脉冲（空闲不闪）
  const signature = reply.reasoning || "";
  const hasContent = streaming || hasReasoning;
  const alive = useContentPulse(signature, hasContent);

  // 思考过程流式增长时，滚动条始终贴底，保证新内容可见
  useEffect(() => {
    const el = codeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reply.reasoning]);

  return (
    <FloatingPanel
      devId="trace-reasoning"
      title="对话流-思考过程"
      defaultPos={{ x: 970, y: 80 }}
      width={320}
      open={open}
      onClose={onClose}
      headClass={alive ? "alive" : ""}
      index={index}
    >
      <details className="trace-section" open>
        <summary>思考过程</summary>
        <div className="trace-sec-body">
          {hasReasoning ? (
            <pre className="trace-code" ref={codeRef}>{reply.reasoning}</pre>
          ) : streaming ? (
            <LoadingDots label="模型思考中…" />
          ) : (
            <TraceIdle
              title="思考过程 · 待机"
              sub="模型开始思考后，推理链会实时滚动显示在这里。"
            />
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
