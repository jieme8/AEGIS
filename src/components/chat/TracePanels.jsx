import { TraceReqAndMcp } from "./trace/TraceReqAndMcp.jsx";
import { TracePromptReasoning } from "./trace/TracePromptReasoning.jsx";
import { TraceMemory } from "./trace/TraceMemory.jsx";
import { isCompactLayout } from "../../lib/layoutMode.js";

/*
 * 模型对话过程 · 3 个独立桌面浮层（trace-reply 已移除，AI 对话框本身已有流式返回）
 * 不再是一个大块（trace-float），而是把 01/03~05 拆成 3 个各自独立的浮层，
 * 分别放在桌面上（各带 data-dev-id、可独立拖动、可独立关闭）。
 * 它们仍同属「模型对话过程（对话流）」，由同一个 trace 数据驱动；
 * 三个浮层各自独立开合（reqMcpOpen / promptReasoningOpen / memoryOpen），
 * 头部「对话流」按钮则一键同开同关。index 用于错落入场动画。
 *
 * 紧凑模式（stack）默认位置：trace-prompt-reasoning 落在 (640,80)，
 * 其余浮层沿用默认错落；trace-req-mcp / trace-memory 在紧凑模式下默认不自动展开。
 *
 * 注：原 02 · 附加上下文已合并进 TracePrompt（03）；原 05 · 内容校验溯源已改为气泡内标注；
 * 注：07 · 记忆召回（Memory）浮层显示本轮检索到的长期记忆，与 MCP 工具浮层同级。
 * 注：原 01 · 请求状态 + 06 · 工具调用 合并为 TraceReqAndMcp（devId=trace-req-mcp）；
 * 注：原 03 · 提示词 + 04 · 思考过程 合并为 TracePromptReasoning（devId=trace-prompt-reasoning）。
 */
export function TracePanels({
  trace,
  reqMcpOpen,
  promptReasoningOpen,
  memoryOpen,
  onCloseReqMcp,
  onClosePromptReasoning,
  onCloseMemory,
}) {
  // 紧凑模式下，trace-prompt-reasoning 默认 dock 到 (640,80)，与 image-window(330,80) 错开成双栏。
  // 宽屏默认坐标 970,80；紧凑模式改为 660,80（与 image-window@330,80 错开，互不冲突）
  const promptReasoningPos = isCompactLayout() ? { x: 660, y: 80 } : { x: 970, y: 80 };
  return (
    <>
      <TraceReqAndMcp
        trace={trace}
        open={reqMcpOpen}
        onClose={onCloseReqMcp}
        index={0}
        total={3}
      />
      <TracePromptReasoning
        trace={trace}
        open={promptReasoningOpen}
        onClose={onClosePromptReasoning}
        index={1}
        total={3}
        defaultPos={promptReasoningPos}
      />
      <TraceMemory
        trace={trace}
        open={memoryOpen}
        onClose={onCloseMemory}
        index={2}
        total={3}
      />
    </>
  );
}
