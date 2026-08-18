import { useEffect, useRef } from "react";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";
import { sanitizeImageRefs } from "../../../lib/traceSanitize.js";

/**
 * 02 · 附加上下文（独立桌面浮层）
 * 显示历史对话记录、附加上下文注入、检索资料。
 */
export function TraceContext({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const ctx = t.context || {};
  const history = ctx.history || [];
  const histRef = useRef(null);

  // 历史里的每条文本都过滤掉 @image#N / <image_local_path> 等引用
  const historyDisplay = history.map((m) => ({
    ...m,
    content: sanitizeImageRefs(m.content),
  }));

  // 新历史追加时把滚动条贴到底部，始终看到最新一轮（与 trace-reasoning 思考过程一致）
  useEffect(() => {
    const el = histRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  return (
    <FloatingPanel
      devId="trace-context"
      title="对话流-02附加上下文"
      defaultPos={{ x: 330, y: 310 }}
      width={300}
      open={open}
      onClose={onClose}
      index={index}
    >
      <details className="trace-section" open>
        <summary><span className="sec-idx">02</span> 附加上下文</summary>
        <div className="trace-sec-body">
          <div className="trace-sub">历史对话（最近 {history.length} 轮，实际随请求发送）</div>
          <div className="trace-hist" ref={histRef}>
            {history.length === 0 && <div className="trace-empty">（无历史）</div>}
            {historyDisplay.map((m, i) => (
              <div className={`trace-hist-item ${m.role}`} key={i}>
                <span className="trace-role">{m.role === "user" ? "USER" : "AI"}</span>
                <span className="trace-htext">{m.content}</span>
              </div>
            ))}
          </div>

          <div className="trace-sub">附加上下文</div>
          <pre className="trace-code trace-empty">（无频谱/实时数据注入，仅携带历史对话上下文）</pre>

          <div className="trace-sub">检索资料</div>
          <pre className="trace-code trace-empty">（暂无检索资料，预留扩展）</pre>
        </div>
      </details>
    </FloatingPanel>
  );
}
