import { TraceRequestStatus } from "./trace/TraceRequestStatus.jsx";
import { TracePrompt } from "./trace/TracePrompt.jsx";
import { TraceReasoning } from "./trace/TraceReasoning.jsx";
import { TraceMcpTools } from "./trace/TraceMcpTools.jsx";

/*
 * 模型对话过程 · 4 个独立桌面浮层（trace-reply 已移除，AI 对话框本身已有流式返回）
 * 不再是一个大块（trace-float），而是把 01/03~05 拆成 4 个各自独立的浮层，
 * 分别放在桌面上（各带 data-dev-id、可独立拖动、可独立关闭）。
 * 它们仍同属「模型对话过程（对话流）」，由同一个 trace 数据驱动，跟随 open 一起显隐。
 * index 用于错落入场动画。
 *
 * 注：原 TraceContext（02 附加上下文）已合并到 TracePrompt（03）中，不再独立渲染。
 */
export function TracePanels({ trace, open, onClose }) {
  return (
    <>
      <TraceRequestStatus trace={trace} open={open} onClose={onClose} index={0} total={4} />
      <TracePrompt trace={trace} open={open} onClose={onClose} index={1} total={4} />
      <TraceReasoning trace={trace} open={open} onClose={onClose} index={2} total={4} />
      <TraceMcpTools trace={trace} open={open} onClose={onClose} index={3} total={4} />
    </>
  );
}
