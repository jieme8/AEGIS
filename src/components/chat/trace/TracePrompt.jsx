import { CopyButton } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";

/**
 * 03 · 实际提示词（独立桌面浮层）
 * 显示 System Prompt 和完整 Messages（实际发送给模型的请求体）。
 */
export function TracePrompt({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const prompt = t.prompt || {};

  return (
    <FloatingPanel
      devId="trace-prompt"
      title="对话流-03提示词"
      defaultPos={{ x: 970, y: 360 }}
      width={320}
      open={open}
      onClose={onClose}
      index={index}
    >
      <details className="trace-section" open>
        <summary><span className="sec-idx">03</span> 提示词</summary>
        <div className="trace-sec-body">
          <div className="trace-sub">
            System Prompt
            <CopyButton text={prompt.system || ""} />
          </div>
          <pre className="trace-code">{prompt.system || "（空）"}</pre>

          <div className="trace-sub">
            完整 Messages（实际发送给模型的请求体）
            <CopyButton text={JSON.stringify(prompt.messages || [], null, 2)} />
          </div>
          <pre className="trace-code">{JSON.stringify(prompt.messages || [], null, 2)}</pre>
        </div>
      </details>
    </FloatingPanel>
  );
}
