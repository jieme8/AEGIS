import { CopyButton, MCP_STATUS } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";

/**
 * 06 · 工具调用（MCP）（独立桌面浮层）
 * 显示本次对话触发的 MCP 工具调用列表（含入参/返回），默认展开。
 */
export function TraceMcpTools({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const mcp = t.mcp || null;
  const invocations = (mcp && mcp.invocations) || [];
  const mcpMeta = (mcp && MCP_STATUS[mcp.status]) || MCP_STATUS.pending;

  return (
    <FloatingPanel
      devId="trace-mcp-tools"
      title="对话流-05工具调用"
      defaultPos={{ x: 980, y: 460 }}
      width={320}
      open={open}
      onClose={onClose}
      index={index}
    >
      <details className="trace-section" open>
        <summary>
          <span className="sec-idx">05</span> 工具调用（MCP）
          {mcp && mcp.enabled && (
            <span className={`trace-mcp-badge ${mcpMeta.cls}`}>{mcpMeta.label}</span>
          )}
        </summary>
        <div className="trace-sec-body">
          {!mcp || !mcp.enabled ? (
            <div className="trace-empty">（MCP 工具未启用）</div>
          ) : mcp.status === "unavailable" ? (
            <div className="trace-empty warn">
              MCP 当前不可用，已自动降级为无工具对话。请在终端确认 `npm run mcp-relay` 已启动。
            </div>
          ) : invocations.length === 0 ? (
            <div className="trace-empty">（本次对话未触发任何工具调用）</div>
          ) : (
            invocations.map((inv, i) => (
              <div className="trace-tool" key={inv.callId || i}>
                <div className="trace-tool-head">
                  <span className="trace-tool-idx">{i + 1}</span>
                  <span className="trace-tool-name">{inv.name}</span>
                  {inv.server && <span className="trace-tool-server">@{inv.server}</span>}
                  {inv.isError && <span className="trace-tool-err">执行失败</span>}
                </div>
                <div className="trace-sub">
                  入参
                  <CopyButton text={JSON.stringify(inv.args ?? {}, null, 2)} />
                </div>
                <pre className="trace-code">{JSON.stringify(inv.args ?? {}, null, 2)}</pre>
                <div className="trace-sub">
                  返回
                  <CopyButton text={typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result ?? "", null, 2)} />
                </div>
                <pre className={`trace-code${inv.isError ? " err" : ""}`}>
                  {typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result ?? "", null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
