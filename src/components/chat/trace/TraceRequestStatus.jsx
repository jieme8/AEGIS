import { STATUS_META, fmtTime, LoadingDots } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";

/**
 * 01 · 请求状态（独立桌面浮层）
 * 显示当前对话请求的状态、模型、模式、发送时间。
 */
export function TraceRequestStatus({ trace, open, onClose, index = 0 }) {
  const meta = (trace && STATUS_META[trace.status]) || STATUS_META.sending;
  const t = trace || {};
  const streaming = t.status === "streaming" || t.status === "sending";

  return (
    <FloatingPanel
      devId="trace-request-status"
      title="对话流-01请求状态"
      defaultPos={{ x: 330, y: 80 }}
      width={300}
      open={open}
      onClose={onClose}
      index={index}
    >
      <details className="trace-section" open>
        <summary><span className="sec-idx">01</span> 请求状态</summary>
        <div className="trace-sec-body">
          <div className="panel trace-kv">
            <div className="k">状态</div>
            <div className={`v ${meta.cls}`}>{meta.label}</div>
            <div className="k">模型</div>
            <div className="v mag">{t.model || "—"}</div>
            <div className="k">模式</div>
            <div className="v">{t.mode === "local"
              ? "本地模拟（接口失败回退）"
              : t.mode === "longcat-no-mcp"
                ? "真实大模型（MCP 不可用）"
                : (t.key ? "真实大模型 · " + t.key.label : "真实大模型")}
            </div>
            <div className="k">发送时间</div>
            <div className="v">{fmtTime(t.sentAt)}</div>
            <div className="k">当前密钥</div>
            <div className="v mag">{t.key ? t.key.label : "—"}</div>
          </div>
          {streaming && (
            <LoadingDots label={t.status === "sending" ? "已发送，等待模型首个 token…" : "正在接收流式输出…"} />
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
