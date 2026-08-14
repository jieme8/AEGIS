import { TraceRequestStatus } from "./trace/TraceRequestStatus.jsx";
import { TraceContext } from "./trace/TraceContext.jsx";
import { TracePrompt } from "./trace/TracePrompt.jsx";
import { TraceReasoning } from "./trace/TraceReasoning.jsx";
import { TraceMcpTools } from "./trace/TraceMcpTools.jsx";

/*
 * 模型对话过程 · 5 个独立桌面浮层（trace-reply 已移除，AI 对话框本身已有流式返回）
 * 不再是一个大块（trace-float），而是把 01~05 拆成 5 个各自独立的浮层，
 * 分别放在桌面上（各带 data-dev-id、可独立拖动、可独立关闭）。
 * 它们仍同属「模型对话过程（对话流）」，由同一个 trace 数据驱动，跟随 open 一起显隐。
 * index 用于错落入场动画。
 */
export function TracePanels({ trace, open, onClose }) {
  return (
    <>
      <TraceRequestStatus trace={trace} open={open} onClose={onClose} index={0} total={5} />
      <TraceContext trace={trace} open={open} onClose={onClose} index={1} total={5} />
      <TracePrompt trace={trace} open={open} onClose={onClose} index={2} total={5} />
      <TraceReasoning trace={trace} open={open} onClose={onClose} index={3} total={5} />
      <TraceMcpTools trace={trace} open={open} onClose={onClose} index={4} total={5} />
    </>
  );
}
