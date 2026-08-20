import { useEffect, useRef } from "react";
import {
  CopyButton, useContentPulse, useTypewriter, TraceIdle, LoadingDots,
} from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";
import { sanitizeImageRefs } from "../../../lib/traceSanitize.js";

/**
 * 对话流 · 提示词 + 思考过程 合并浮层
 * 把原 trace-prompt（03）与 trace-reasoning（04）两个独立桌面浮层合并为单个窗口，
 * 内部用两个 <details> 折叠分区呈现，与 TraceReqAndMcp / TraceMemory 视觉同构。
 *   - 分区① 提示词：System Prompt + 完整 Messages（打字机逐字揭示、可复制、待机态）
 *   - 分区② 思考过程：模型的 reasoning_content（流式滚动、LoadingDots、待机态）
 * 两个分区各自用 useContentPulse，保留「哪块在更新哪块亮」的流光语义。
 */
export function TracePromptReasoning({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const prompt = t.prompt || {};
  const reply = t.reply || {};

  // —— 分区① 提示词 pulse：System Prompt / Messages 真正变化且有内容时脉冲 ——
  const promptSig = (prompt.system || "") + "||" + JSON.stringify(prompt.messages || []);
  const hasSystem = !!prompt.system;
  const hasMessages = !!(prompt.messages && prompt.messages.length);
  const hasPromptContent = hasSystem || hasMessages;
  const promptAlive = useContentPulse(promptSig, hasPromptContent);

  // —— 分区② 思考过程 pulse ——
  const streaming = t.status === "streaming" || t.status === "sending";
  const hasReasoning = !!(reply.reasoning && reply.reasoning.length);
  const reasonSig = reply.reasoning || "";
  const hasReasonContent = streaming || hasReasoning;
  const reasonAlive = useContentPulse(reasonSig, hasReasonContent);

  // 滚动贴底 refs（提示词区 body/messages、思考区 reasoning 各自独立）
  const bodyRef = useRef(null);
  const msgRef = useRef(null);
  const codeRef = useRef(null);
  const pinBottom = () => {
    const m = msgRef.current;
    if (m) m.scrollTop = m.scrollHeight;
    const b = bodyRef.current;
    if (b) b.scrollTop = b.scrollHeight;
  };

  // 给"展示给用户看"的版本做图像引用/路径过滤，避免 trace 暴露本地路径 / @image#N
  const typedSystem = useTypewriter(sanitizeImageRefs(prompt.system || ""), { onTick: pinBottom });
  const typedMessages = useTypewriter(
    sanitizeImageRefs(JSON.stringify(prompt.messages || [], null, 2)),
    { onTick: pinBottom },
  );
  // 复制按钮仍然给原文（含引用，便于用户复制粘贴完整 prompt）
  const systemCopy = prompt.system || "";
  const messagesCopy = JSON.stringify(prompt.messages || [], null, 2);

  // Messages 内部 code 块贴底
  useEffect(() => {
    const el = msgRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [prompt.messages]);

  // 整个提示词分区内容区默认贴底
  useEffect(() => {
    const el = bodyRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [open, prompt.system, prompt.messages]);

  // 思考过程流式增长时，滚动条始终贴底
  useEffect(() => {
    const el = codeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reply.reasoning]);

  return (
    <FloatingPanel
      devId="trace-prompt-reasoning"
      title="对话流·提示词与思考"
      defaultPos={{ x: 970, y: 80 }}
      width={320}
      open={open}
      onClose={onClose}
      index={index}
    >
      {/* 分区① 提示词 */}
      <details className="trace-section" open>
        <summary className={promptAlive ? "alive" : ""}>提示词</summary>
        <div className="trace-sec-body" ref={bodyRef}>
          {!hasPromptContent ? (
            <TraceIdle
              title="提示词流 · 待机中"
              sub="发起一次对话后，System Prompt 与完整 Messages 会自动空投到这里。"
            />
          ) : (
            <>
              {/* System Prompt */}
              <div className="trace-sub">
                System Prompt
                <CopyButton text={systemCopy} />
              </div>
              <pre className={"trace-code" + (hasSystem ? "" : " trace-empty")}>
                {typedSystem || "（空）"}
              </pre>

              {/* 完整 Messages */}
              <div className="trace-sub">
                完整 Messages（发送给模型）
                <CopyButton text={messagesCopy} />
              </div>
              <pre
                className={"trace-code" + (hasMessages ? "" : " trace-empty")}
                ref={msgRef}
              >
                {typedMessages || "（空）"}
              </pre>
            </>
          )}
        </div>
      </details>

      {/* 分区② 思考过程 */}
      <details className="trace-section" open>
        <summary className={reasonAlive ? "alive" : ""}>思考过程</summary>
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
