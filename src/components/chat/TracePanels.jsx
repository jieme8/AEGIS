import { TraceRequestStatus } from "./trace/TraceRequestStatus.jsx";
import { TracePrompt } from "./trace/TracePrompt.jsx";
import { TraceReasoning } from "./trace/TraceReasoning.jsx";
import { TraceMcpTools } from "./trace/TraceMcpTools.jsx";
import { TraceMemory } from "./trace/TraceMemory.jsx";

/*
 * 模型对话过程 · 5 个独立桌面浮层（trace-reply 已移除，AI 对话框本身已有流式返回）
 * 不再是一个大块（trace-float），而是把 01/03~05 拆成 5 个各自独立的浮层，
 * 分别放在桌面上（各带 data-dev-id、可独立拖动、可独立关闭）。
 * 它们仍同属「模型对话过程（对话流）」，由同一个 trace 数据驱动，跟随 open 一起显隐。
 * index 用于错落入场动画。
 *
 * 注：原 TraceContext（02 附加上下文）已合并到 TracePrompt（03）中，不再独立渲染。
 * 注：原 05 · 内容校验溯源浮层已移除——溯源信息改为直接显示在 AI 对话气泡内
 *     （attachProvenanceFooter），不再单独开窗口，落实「直接在对话框里标注内容来源」。
 * 注：07 · 记忆召回（Memory）浮层显示本轮检索到的长期记忆，与 MCP 工具浮层同级。
 */
export function TracePanels({ trace, open, onClose }) {
  return (
    <>
      <TraceRequestStatus trace={trace} open={open} onClose={onClose} index={0} total={5} />
      <TracePrompt trace={trace} open={open} onClose={onClose} index={1} total={5} />
      <TraceReasoning trace={trace} open={open} onClose={onClose} index={2} total={5} />
      <TraceMcpTools trace={trace} open={open} onClose={onClose} index={3} total={5} />
      <TraceMemory trace={trace} open={open} onClose={onClose} index={4} total={5} />
    </>
  );
}
