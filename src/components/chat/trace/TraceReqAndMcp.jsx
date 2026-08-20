import { useState } from "react";
import {
  STATUS_META, fmtTime, useContentPulse, CopyButton, MCP_STATUS, TraceIdle,
} from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";
import { sanitizeImageRefs, sanitizeField } from "../../../lib/traceSanitize.js";

/**
 * 对话流 · 请求状态 + 工具调用（MCP）合并浮层
 * 把原 trace-request-status（01）与 trace-mcp-tools（06）两个独立桌面浮层
 * 合并为单个窗口，内部用两个 <details> 折叠分区呈现，与 TracePrompt /
 * TraceReasoning / TraceMemory 视觉同构。
 *   - 分区① 请求状态：状态/模型/模式/发送时间/当前密钥（KV 表）
 *   - 分区② 工具调用：MCP 启用态、调用列表（可展开入参/返回、可复制）
 * 两个分区各自用 useContentPulse，保留「哪块在更新哪块亮」的流光语义。
 */
export function TraceReqAndMcp({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const meta = (t && STATUS_META[t.status]) || STATUS_META.sending;

  // —— 分区① 请求状态 pulse：状态/模型/模式/时间/密钥任一变化即脉冲 ——
  const reqSig = `${t.status}|${t.model}|${t.mode}|${t.sentAt}|${t.key ? t.key.label : ""}`;
  const reqAlive = useContentPulse(reqSig, true);

  // —— 分区② 工具调用 pulse ——
  const mcp = t.mcp || null;
  const invocations = (mcp && mcp.invocations) || [];
  const mcpMeta = (mcp && MCP_STATUS[mcp.status]) || MCP_STATUS.pending;
  const mcpSig =
    `${mcp ? mcp.status : "none"}|${invocations.length}|` +
    invocations
      .map((i) =>
        `${i.callId}:${i.isError ? 1 : 0}:` +
        ((typeof i.result === "string" ? i.result : JSON.stringify(i.result || "")).slice(0, 40)))
      .join("|");
  const mcpActive = !!(mcp && mcp.enabled && mcp.status && mcp.status !== "pending");
  const hasMcpContent = invocations.length > 0 || mcpActive;
  const mcpAlive = useContentPulse(mcpSig, hasMcpContent);

  // 工具调用展开状态（按 callId 记录）
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // 安全显示任意 MCP 文本字段（name/server/result/args 统一过滤）
  const safeText = (val) => {
    if (!val) return "";
    const text = typeof val === "string" ? val : safeJson(val);
    return sanitizeImageRefs(text);
  };
  const summarize = (result) => sanitizeField(result);
  function safeJson(v) {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }

  return (
    <FloatingPanel
      devId="trace-req-mcp"
      title="对话流·请求与工具"
      defaultPos={{ x: 330, y: 80 }}
      width={300}
      open={open}
      onClose={onClose}
      index={index}
    >
      {/* 分区① 请求状态 */}
      <details className="trace-section" open>
        <summary className={reqAlive ? "alive" : ""}>请求状态</summary>
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
        </div>
      </details>

      {/* 分区② 工具调用（MCP） */}
      <details className="trace-section" open>
        <summary className={mcpAlive ? "alive" : ""}>
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
            <TraceIdle
              variant="muted"
              title="MCP 工具未启用"
              sub="在终端运行 npm run mcp-relay 启用后，工具调用会显示在这里。"
            />
          ) : mcp.status === "unavailable" ? (
            <TraceIdle
              variant="warn"
              title="MCP 当前不可用"
              sub="已自动降级为无工具对话。请确认 npm run mcp-relay 已启动。"
            />
          ) : invocations.length === 0 ? (
            <TraceIdle
              title="工具调用 · 待机"
              sub="本次对话尚未触发任何工具调用。"
            />
          ) : (
            invocations.map((inv, i) => {
              // callId 在每个 LLM 回合会重置（call_0/call_1…），跨回合会重复，
              // 拼上数组下标保证 React key 全局唯一，避免 duplicate-key 警告。
              const key = `${inv.callId || `tool-${i}`}__${i}`;
              const exp = !!expanded[inv.callId || `tool-${i}`];
              return (
                <div className="trace-tool" key={key}>
                  <div
                    className="trace-tool-head"
                    onClick={() => toggleExpand(key)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="trace-tool-idx">{i + 1}</span>
                    <span className="trace-tool-name">{safeText(inv.name)}</span>
                    {inv.server && <span className="trace-tool-server">@{safeText(inv.server)}</span>}
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
                      <pre className="trace-code">{safeText(JSON.stringify(inv.args ?? {}, null, 2))}</pre>
                      <div className="trace-sub">
                        返回（完整）
                        <CopyButton text={typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result ?? "", null, 2)} />
                      </div>
                      <pre className={`trace-code${inv.isError ? " err" : ""}`}>
                        {safeText(typeof inv.result === "string" ? inv.result : safeJson(inv.result))}
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
