import { useEffect, useRef } from "react";
import { CopyButton, useContentPulse } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";
import { sanitizeImageRefs } from "../../../lib/traceSanitize.js";

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
  // 仅在 System Prompt / Messages 真正变化且有内容时，标题栏才脉冲
  const signature = (prompt.system || "") + "||" + JSON.stringify(prompt.messages || []);
  const hasContent = !!(prompt.system || (prompt.messages && prompt.messages.length));
  const alive = useContentPulse(signature, hasContent);

  // 给"展示给用户看"的版本做图像引用/路径过滤，避免 trace 暴露本地路径 / @image#N
  const systemDisplay = sanitizeImageRefs(prompt.system || "");
  const messagesJsonDisplay = sanitizeImageRefs(JSON.stringify(prompt.messages || [], null, 2));
  // 复制按钮仍然给原文（含引用，便于用户复制粘贴完整 prompt）
  const systemCopy = prompt.system || "";
  const messagesCopy = JSON.stringify(prompt.messages || [], null, 2);

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
      title="对话流-提示词"
      defaultPos={{ x: 970, y: 340 }}
      width={320}
      open={open}
      onClose={onClose}
      headClass={alive ? "alive" : ""}
      index={index}
    >
      <details className="trace-section" open>
        <summary>提示词</summary>
        <div className="trace-sec-body" ref={bodyRef}>
          {/* System Prompt */}
          <div className="trace-sub">
            System Prompt
            <CopyButton text={systemCopy} />
          </div>
          <pre className="trace-code">{systemDisplay || "（空）"}</pre>

          {/* 完整 Messages */}
          <div className="trace-sub">
            完整 Messages（发送给模型）
            <CopyButton text={messagesCopy} />
          </div>
          <pre className="trace-code" ref={msgRef}>{messagesJsonDisplay}</pre>
        </div>
      </details>
    </FloatingPanel>
  );
}
