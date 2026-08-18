import { useState } from "react";
import { CopyButton, MCP_STATUS, useContentPulse } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";

/**
 * 06 · 工具调用（MCP）（独立桌面浮层）
 * 显示本次对话触发的 MCP 工具调用列表（简略视图：工具名+状态+结果摘要，可展开看完整入参/返回）。
 */
export function TraceMcpTools({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const mcp = t.mcp || null;
  const invocations = (mcp && mcp.invocations) || [];
  const mcpMeta = (mcp && MCP_STATUS[mcp.status]) || MCP_STATUS.pending;
  // 仅在工具调用状态/结果真正变化且有活动时，标题栏才脉冲
  const sig =
    `${mcp ? mcp.status : "none"}|${invocations.length}|` +
    invocations
      .map((i) =>
        `${i.callId}:${i.isError ? 1 : 0}:` +
        ((typeof i.result === "string" ? i.result : JSON.stringify(i.result || "")).slice(0, 40)))
      .join("|");
  const mcpActive = !!(mcp && mcp.enabled && mcp.status && mcp.status !== "pending");
  const hasContent = invocations.length > 0 || mcpActive;
  const alive = useContentPulse(sig, hasContent);
  // 展开状态（按 callId 记录）
  const [expanded, setExpanded] = useState({});

  const toggleExpand = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // 截断结果文本用于摘要显示
  const summarize = (result) => {
    if (!result) return "—";
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text.length > 80 ? text.slice(0, 80) + "…" : text;
  };

  return (
    <FloatingPanel
      devId="trace-mcp-tools"
      title="对话流-工具调用"
      defaultPos={{ x: 330, y: 310 }}
      width={300}
      open={open}
      onClose={onClose}
      headClass={alive ? "alive" : ""}
      index={index}
    >
      <details className="trace-section" open>
        <summary>
          工具调用（MCP）
          {mcp && mcp.enabled && (
            <span className={`trace-mcp-badge ${mcpMeta.cls}`}>{mcpMeta.label}</span>
          )}
          {invocations.length > 0 && (
            <span className="trace-mcp-count">{invocations.length} 次调用</span>
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
            invocations.map((inv, i) => {
              const key = inv.callId || `tool-${i}`;
              const exp = !!expanded[key];
              return (
                <div className="trace-tool" key={key}>
                  <div
                    className="trace-tool-head"
                    onClick={() => toggleExpand(key)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="trace-tool-idx">{i + 1}</span>
                    <span className="trace-tool-name">{inv.name}</span>
                    {inv.server && <span className="trace-tool-server">@{inv.server}</span>}
                    {inv.isError && <span className="trace-tool-err">失败</span>}
                    <span className="trace-tool-toggle">{exp ? "▼ 收起" : "▶ 详情"}</span>
                  </div>

                  {/* 始终显示的结果摘要行 */}
                  <div className="trace-tool-summary">
                    <span className="trace-sum-label">结果</span>
                    <span className={`trace-sum-val${inv.isError ? " err" : ""}`}>
                      {summarize(inv.result)}
                    </span>
                  </div>

                  {/* 展开后显示完整入参+返回 */}
                  {exp && (
                    <>
                      <div className="trace-sub">
                        入参
                        <CopyButton text={JSON.stringify(inv.args ?? {}, null, 2)} />
                      </div>
                      <pre className="trace-code">{JSON.stringify(inv.args ?? {}, null, 2)}</pre>
                      <div className="trace-sub">
                        返回（完整）
                        <CopyButton text={typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result ?? "", null, 2)} />
                      </div>
                      <pre className={`trace-code${inv.isError ? " err" : ""}`}>
                        {typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result ?? "", null, 2)}
                      </pre>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
