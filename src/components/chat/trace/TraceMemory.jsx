<<<<<<< HEAD
import { useState } from "react";
import { CopyButton, TraceIdle } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";
import { extractMemoryToolReads } from "../../../lib/recall.js";

/**
 * 07 · 记忆召回（独立桌面浮层）
 * 显示本轮对话构造 prompt 时，按用户问题从长期记忆库检索到的条目（search_memory）。
 * 与 MCP 工具调用浮层同级，让「每次聊天读取了记忆」在对话流里可见、可展开核对。
 */
export function TraceMemory({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const mem = t.memory || null;
  const enabled = !mem || mem.enabled !== false;
  const proactiveEntries = (mem && mem.entries) || [];
  const proactiveCount = (mem && mem.count) || proactiveEntries.length;

  // 同时收集 LLM 在 tool-loop 中自行读取的记忆（get_memory / search_memory / list_memories）
  const toolReads = extractMemoryToolReads((t.mcp && t.mcp.invocations) || []);
  const toolReadEntries = toolReads.map((inv, i) => ({
    key: `tool:${inv.name}:${i}`,
    name: inv.name,
    args: inv.args || {},
    result: inv.result,
    server: inv.server,
    idx: i,
  }));

  const totalCount = proactiveCount + toolReadEntries.length;
  const hasProactive = proactiveCount > 0;
  const hasToolRead = toolReadEntries.length > 0;
  const hasContent = hasProactive || hasToolRead;

  // status 合并展示：优先 proactive，其次工具读取，最后空/关闭
  let status = "empty";
  if (!enabled) status = "disabled";
  else if (hasProactive && hasToolRead) status = "mixed";
  else if (hasProactive) status = "hit";
  else if (hasToolRead) status = "tool";

  const statusMeta =
    status === "hit"
      ? { cls: "lv-high", label: `召回 ${proactiveCount} 条` }
      : status === "tool"
        ? { cls: "lv-high", label: `工具读取 ${toolReadEntries.length} 条` }
        : status === "mixed"
          ? { cls: "lv-high", label: `召回 ${proactiveCount} + 工具 ${toolReadEntries.length}` }
          : status === "disabled"
            ? { cls: "lv-low", label: "已关闭" }
            : { cls: "lv-medium", label: "无相关记忆" };

  const sig = `${status}|${totalCount}|${(mem ? mem.query : "").slice(0, 30)}|` +
    toolReads.map((r) => r.name).join("|");
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <FloatingPanel
      devId="trace-memory"
      title="对话流-记忆召回"
      defaultPos={{ x: 640, y: 510 }}
      width={320}
      height={260}
      open={open}
      onClose={onClose}
      headClass={hasContent ? "alive" : ""}
      index={index}
    >
      <details className="trace-section" open>
        <summary>
          记忆召回（Memory）
          <span className={`trace-mcp-badge ${statusMeta.cls}`}>{statusMeta.label}</span>
        </summary>
        <div className="trace-sec-body">
          {!enabled ? (
            <TraceIdle
              variant="muted"
              title="记忆召回已关闭"
              sub="在 MCP 面板里打开「主动召回」开关后，长期记忆会注入上下文。"
            />
          ) : !hasContent ? (
            <TraceIdle
              title="记忆召回 · 待机"
              sub="本次对话未检索到相关长期记忆。"
            />
          ) : (
            <>
              {mem && mem.query && (
                <div className="trace-memory-query">
                  <span className="trace-sum-label">问题</span>
                  <span className="trace-memory-q">{mem.query}</span>
                </div>
              )}

              {hasProactive && (
                <div className="trace-sub">主动召回（search_memory）</div>
              )}
              {proactiveEntries.map((e, i) => {
                const key = e.key || `mem-${i}`;
                const exp = !!expanded[key];
                return (
                  <div className="trace-tool" key={key}>
                    <div
                      className="trace-tool-head"
                      onClick={() => toggleExpand(key)}
                      style={{ cursor: "pointer" }}
                    >
                      <span className="trace-tool-idx">{i + 1}</span>
                      <span className="trace-tool-name">{e.key}</span>
                      <span className="trace-tool-toggle">{exp ? "▼ 收起" : "▶ 详情"}</span>
                    </div>
                    <div className="trace-tool-summary">
                      <span className="trace-sum-label">内容</span>
                      <span className="trace-sum-val">
                        {(e.value || "").slice(0, 80)}
                        {(e.value || "").length > 80 ? "…" : ""}
                      </span>
                    </div>
                    {exp && (
                      <>
                        <div className="trace-sub">
                          记忆内容
                          <CopyButton text={e.value || ""} />
                        </div>
                        <pre className="trace-code">{e.value || ""}</pre>
                      </>
                    )}
                  </div>
                );
              })}

              {hasToolRead && (
                <div className="trace-sub">工具调用读取（LLM 自行检索）</div>
              )}
              {toolReadEntries.map((inv, i) => {
                const key = inv.key;
                const exp = !!expanded[key];
                const resultText =
                  typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result || "", null, 2);
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
                      <span className="trace-tool-toggle">{exp ? "▼ 收起" : "▶ 详情"}</span>
                    </div>
                    <div className="trace-tool-summary">
                      <span className="trace-sum-label">目标</span>
                      <span className="trace-sum-val">
                        {inv.args.key || inv.args.query || "—"}
                      </span>
                    </div>
                    {exp && (
                      <>
                        <div className="trace-sub">
                          工具返回
                          <CopyButton text={resultText} />
                        </div>
                        <pre className="trace-code">{resultText}</pre>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
=======
import { useState } from "react";
import { CopyButton, TraceIdle } from "./shared.jsx";
import { FloatingPanel } from "../../common/FloatingPanel.jsx";
import { extractMemoryToolReads } from "../../../lib/recall.js";
import { isCompactViewport } from "../../../lib/viewport.js";

/**
 * 07 · 记忆召回（独立桌面浮层）
 * 显示本轮对话构造 prompt 时，按用户问题从长期记忆库检索到的条目（search_memory）。
 * 与 MCP 工具调用浮层同级，让「每次聊天读取了记忆」在对话流里可见、可展开核对。
 */
export function TraceMemory({ trace, open, onClose, index = 0 }) {
  const t = trace || {};
  const mem = t.memory || null;
  const enabled = !mem || mem.enabled !== false;
  const proactiveEntries = (mem && mem.entries) || [];
  const proactiveCount = (mem && mem.count) || proactiveEntries.length;

  // 同时收集 LLM 在 tool-loop 中自行读取的记忆（get_memory / search_memory / list_memories）
  const toolReads = extractMemoryToolReads((t.mcp && t.mcp.invocations) || []);
  const toolReadEntries = toolReads.map((inv, i) => ({
    key: `tool:${inv.name}:${i}`,
    name: inv.name,
    args: inv.args || {},
    result: inv.result,
    server: inv.server,
    idx: i,
  }));

  const totalCount = proactiveCount + toolReadEntries.length;
  const hasProactive = proactiveCount > 0;
  const hasToolRead = toolReadEntries.length > 0;
  const hasContent = hasProactive || hasToolRead;

  // status 合并展示：优先 proactive，其次工具读取，最后空/关闭
  let status = "empty";
  if (!enabled) status = "disabled";
  else if (hasProactive && hasToolRead) status = "mixed";
  else if (hasProactive) status = "hit";
  else if (hasToolRead) status = "tool";

  const statusMeta =
    status === "hit"
      ? { cls: "lv-high", label: `召回 ${proactiveCount} 条` }
      : status === "tool"
        ? { cls: "lv-high", label: `工具读取 ${toolReadEntries.length} 条` }
        : status === "mixed"
          ? { cls: "lv-high", label: `召回 ${proactiveCount} + 工具 ${toolReadEntries.length}` }
          : status === "disabled"
            ? { cls: "lv-low", label: "已关闭" }
            : { cls: "lv-medium", label: "无相关记忆" };

  const sig = `${status}|${totalCount}|${(mem ? mem.query : "").slice(0, 30)}|` +
    toolReads.map((r) => r.name).join("|");
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <FloatingPanel
      devId="trace-memory"
      title="对话流-记忆召回"
      defaultPos={isCompactViewport() ? { x: 330, y: 510 } : { x: 640, y: 510 }}
      width={320}
      height={260}
      open={open}
      onClose={onClose}
      headClass={hasContent ? "alive" : ""}
      index={index}
    >
      <details className="trace-section" open>
        <summary>
          记忆召回（Memory）
          <span className={`trace-mcp-badge ${statusMeta.cls}`}>{statusMeta.label}</span>
        </summary>
        <div className="trace-sec-body">
          {!enabled ? (
            <TraceIdle
              variant="muted"
              title="记忆召回已关闭"
              sub="在 MCP 面板里打开「主动召回」开关后，长期记忆会注入上下文。"
            />
          ) : !hasContent ? (
            <TraceIdle
              title="记忆召回 · 待机"
              sub="本次对话未检索到相关长期记忆。"
            />
          ) : (
            <>
              {mem && mem.query && (
                <div className="trace-memory-query">
                  <span className="trace-sum-label">问题</span>
                  <span className="trace-memory-q">{mem.query}</span>
                </div>
              )}

              {hasProactive && (
                <div className="trace-sub">主动召回（search_memory）</div>
              )}
              {proactiveEntries.map((e, i) => {
                const key = e.key || `mem-${i}`;
                const exp = !!expanded[key];
                return (
                  <div className="trace-tool" key={key}>
                    <div
                      className="trace-tool-head"
                      onClick={() => toggleExpand(key)}
                      style={{ cursor: "pointer" }}
                    >
                      <span className="trace-tool-idx">{i + 1}</span>
                      <span className="trace-tool-name">{e.key}</span>
                      <span className="trace-tool-toggle">{exp ? "▼ 收起" : "▶ 详情"}</span>
                    </div>
                    <div className="trace-tool-summary">
                      <span className="trace-sum-label">内容</span>
                      <span className="trace-sum-val">
                        {(e.value || "").slice(0, 80)}
                        {(e.value || "").length > 80 ? "…" : ""}
                      </span>
                    </div>
                    {exp && (
                      <>
                        <div className="trace-sub">
                          记忆内容
                          <CopyButton text={e.value || ""} />
                        </div>
                        <pre className="trace-code">{e.value || ""}</pre>
                      </>
                    )}
                  </div>
                );
              })}

              {hasToolRead && (
                <div className="trace-sub">工具调用读取（LLM 自行检索）</div>
              )}
              {toolReadEntries.map((inv, i) => {
                const key = inv.key;
                const exp = !!expanded[key];
                const resultText =
                  typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result || "", null, 2);
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
                      <span className="trace-tool-toggle">{exp ? "▼ 收起" : "▶ 详情"}</span>
                    </div>
                    <div className="trace-tool-summary">
                      <span className="trace-sum-label">目标</span>
                      <span className="trace-sum-val">
                        {inv.args.key || inv.args.query || "—"}
                      </span>
                    </div>
                    {exp && (
                      <>
                        <div className="trace-sub">
                          工具返回
                          <CopyButton text={resultText} />
                        </div>
                        <pre className="trace-code">{resultText}</pre>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </details>
    </FloatingPanel>
  );
}
>>>>>>> 662abb8254c81792abf86b2cccf3c4eb284584e7
