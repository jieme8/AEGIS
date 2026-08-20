import { TraceReqAndMcp } from "./trace/TraceReqAndMcp.jsx";
import { TracePromptReasoning } from "./trace/TracePromptReasoning.jsx";
import { TraceMemory } from "./trace/TraceMemory.jsx";

/*
 * 模型对话过程 · 3 个独立桌面浮层（trace-reply 已移除，AI 对话框本身已有流式返回）
 * 不再是一个大块（trace-float），而是把 01/03~05 拆成 3 个各自独立的浮层，
 * 分别放在桌面上（各带 data-dev-id、可独立拖动、可独立关闭）。
 * 它们仍同属「模型对话过程（对话流）」，由同一个 trace 数据驱动，跟随 open 一起显隐。
 * index 用于错落入场动画。
 *
 * 注：原 TraceContext（02 附加上下文）已合并到 TracePrompt（03）中，不再独立渲染。
 * 注：原 05 · 内容校验溯源浮层已移除——溯源信息改为直接显示在 AI 对话气泡内
 *     （attachProvenanceFooter），不再单独开窗口，落实「直接在对话框里标注内容来源」。
 * 注：07 · 记忆召回（Memory）浮层显示本轮检索到的长期记忆，与 MCP 工具浮层同级。
 * 注：原 01 · 请求状态 与 06 · 工具调用（MCP）已合并为 TraceReqAndMcp（devId=trace-req-mcp）。
 * 注：原 03 · 提示词 与 04 · 思考过程 已合并为 TracePromptReasoning
 *     （devId=trace-prompt-reasoning），窗口内用两个 <details> 折叠分区呈现，total 由 5 降为 3。
 */
export function TracePanels({ trace, open, onClose }) {
  return (
    <>
      <TraceReqAndMcp trace={trace} open={open} onClose={onClose} index={0} total={3} />
      <TracePromptReasoning trace={trace} open={open} onClose={onClose} index={1} total={3} />
      <TraceMemory trace={trace} open={open} onClose={onClose} index={2} total={3} />
    </>
  );
}
