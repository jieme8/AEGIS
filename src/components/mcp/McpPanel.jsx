import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MCPClient } from "../../lib/mcpClient.js";

/*
 * MCP 服务器列表浮层（独立浮层，Portal 挂到 document.body，不受任何父容器限制）
 * 展示当前配置中所有 MCP 服务器的名称、运行时状态（已连接/未启用/异常/连接中）、
 * 工具清单与错误原因，并给出「可用 / 总数」汇总。打开时自动轮询 /api/mcp/status。
 *
 * 状态语义（服务器注册表级，区别于 ChatTraceDrawer 的单轮对话级 mcp.status）：
 *   connected  已连接  —— enabled && 已连 && 有工具 → 可正常使用
 *   disabled   未启用  —— 配置中 enabled=false
 *   error      异常    —— enabled 但连接/初始化失败（看 error 字段）
 *   connecting 连接中  —— 启动初始化进行中（瞬时态）
 */

// status -> 文案 / 配色 class（复用 trace 配色：done/active/pending/err）
const STATUS_META = {
  connected:  { label: "已连接", cls: "done" },
  disabled:   { label: "未启用", cls: "pending" },
  error:      { label: "异常",   cls: "err" },
  connecting: { label: "连接中", cls: "active" },
};

function LoadingDots({ label }) {
  return (
    <div className="trace-loading">
      <span className="tdot" /><span className="tdot" /><span className="tdot" />
      <span className="trace-loading-label">{label}</span>
    </div>
  );
}

function McpRow({ s }) {
  const meta = STATUS_META[s.status] || STATUS_META.connecting;
  const usable = s.status === "connected";
  return (
    <div className="mcp-row" data-dev-id={`mcp-server-${s.name}`}>
      <div className="mcp-row-head">
        <span className="mcp-name">{s.name}</span>
        <span className={`mcp-badge ${meta.cls}`}>
          <span className="mcp-dot" />
          {meta.label}
        </span>
      </div>
      <div className="mcp-row-meta">
        <span>transport: {s.transport}</span>
        <span>tools: {s.toolCount}</span>
        <span className={usable ? "mcp-usable" : "mcp-unusable"}>
          {usable ? "可用 ✓" : "不可用"}
        </span>
      </div>
      {s.error && <div className="mcp-err">⚠ {s.error}</div>}
      {s.tools && s.tools.length > 0 && (
        <div className="mcp-tools">
          {s.tools.map((t) => (
            <span className="mcp-tool" key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function McpPanel({ open, onClose }) {
  const boxRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const clientRef = useRef(null);
  if (!clientRef.current) clientRef.current = new MCPClient();

  const fetchStatus = async () => {
    try {
      const d = await clientRef.current.getStatus();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e && e.message ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // 打开时立即拉取，并以 5s 间隔轮询；关闭时停止
  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => clearInterval(timer);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 标题栏拖动（与 ChatTraceDrawer 同款：浮层为 body 级元素，全页可拖）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".mcp-close")) return;
    const box = boxRef.current;
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const origLeft = box.offsetLeft, origTop = box.offsetTop;
    box.style.right = "auto";
    setDragging(true);
    box.style.userSelect = "none";
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const maxLeft = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.max(0, Math.min(origLeft + dx, maxLeft)) + "px";
      box.style.top = Math.max(0, Math.min(origTop + dy, maxTop)) + "px";
    };
    const onUp = () => {
      setDragging(false);
      box.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  if (!open) return null;

  const summary = (data && data.summary) || { total: 0, usable: 0, connected: 0, disabled: 0, error: 0 };
  const servers = (data && data.servers) || [];

  return createPortal(
    <div
      ref={boxRef}
      className={"mcp-panel" + (dragging ? " dragging" : "")}
      role="dialog"
      aria-modal="false"
      aria-label="MCP 服务器列表"
      data-dev-id="mcp-panel"
    >
      <div className="mcp-head" onPointerDown={onHeadPointerDown}>
        <span className="mcp-title">MCP 服务器 · SERVERS</span>
        <span className="mcp-count">{summary.usable}/{summary.total} 可用</span>
        <button className="mcp-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
      </div>

      <div className="mcp-body">
        {loading && <LoadingDots label="正在查询 MCP 状态…" />}
        {!loading && error && (
          <div className="mcp-empty err mcp-hint">
            <div className="mcp-warn-title">⚠ MCP 服务不可用</div>
            <p>无法连接 MCP Relay（<code>/api/mcp/status</code> 请求失败）。</p>
            <p>本项目的 MCP 工具依赖 Node 侧 Relay 进程——<b>只跑 <code>npm run dev</code>（仅 vite）是不会带起 Relay 的</b>，所以面板里的 MCP 全部不可用。</p>
            <p>请用以下任一方式重启，再刷新本面板：</p>
            <pre className="mcp-cmd">npm run dev:all   # 同时启动 vite + Relay（推荐）</pre>
            <pre className="mcp-cmd">npm run mcp-relay  # 仅启动 Relay（vite 另开）</pre>
          </div>
        )}
        {!loading && !error && servers.length === 0 && (
          <div className="mcp-empty">（未配置任何 MCP 服务器）</div>
        )}
        {!loading && !error && servers.map((s) => (
          <McpRow s={s} key={s.name} />
        ))}
      </div>
    </div>,
    document.body
  );
}
