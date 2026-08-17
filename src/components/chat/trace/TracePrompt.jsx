import { useEffect, useRef } from "react";
import { CopyButton } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";

/**
 * 03 · 提示词（独立桌面浮层）
 * 展示 System Prompt + 完整 Messages（发送给模型）。
 * 历史对话、附加上下文、检索资料均已移除（精简视图）。
 */
export function TracePrompt({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const prompt = t.prompt || {};
  const ctx = t.context || {};
  const msgRef = useRef(null);
  const bodyRef = useRef(null);

  // Messages 内部 code 块贴底
  useEffect(() => {
    const el = msgRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [prompt.messages]);

  // 整个面板内容区默认贴底（与 trace-reasoning 一致）
  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [open, prompt.system, prompt.messages]);

  return (
    <FloatingPanel
      devId="trace-prompt"
      title="对话流-03提示词"
      defaultPos={{ x: 970, y: 340 }}
      width={320}
      open={open}
      onClose={onClose}
      index={index}
    >
      <details className="trace-section" open>
        <summary><span className="sec-idx">03</span> 提示词</summary>
        <div className="trace-sec-body" ref={bodyRef}>
          {/* System Prompt */}
          <div className="trace-sub">
            System Prompt
            <CopyButton text={prompt.system || ""} />
          </div>
          <pre className="trace-code">{prompt.system || "（空）"}</pre>

          {/* 完整 Messages */}
          <div className="trace-sub">
            完整 Messages（发送给模型）
            <CopyButton text={JSON.stringify(prompt.messages || [], null, 2)} />
          </div>
          <pre className="trace-code" ref={msgRef}>{JSON.stringify(prompt.messages || [], null, 2)}</pre>
        </div>
      </details>
    </FloatingPanel>
  );
}
