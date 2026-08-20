import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MCPClient } from "../../lib/mcpClient.js";
import { isAutoMemoryEnabled, setAutoMemoryEnabled } from "../../lib/autoMemory.js";
import { isRecallEnabled, setRecallEnabled } from "../../lib/recall.js";

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

function McpRow({ s, client, onOpenMemory, callingTool, usedTools = [] }) {
  const meta = STATUS_META[s.status] || STATUS_META.connecting;
  const usable = s.status === "connected";
  const isMemory = s.name === "memory" && usable && client;
  const onCardKey = (e) => {
    if (!isMemory) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenMemory && onOpenMemory();
    }
  };
  return (
    <div
      className={"mcp-row" + (isMemory ? " mcp-row-clickable" : "")}
      data-dev-id={`mcp-server-${s.name}`}
      {...(isMemory
        ? {
            role: "button",
            tabIndex: 0,
            title: "点击查看 / 管理已记录的记忆",
            onClick: (e) => {
              e.stopPropagation();
              onOpenMemory && onOpenMemory();
            },
            onKeyDown: onCardKey,
          }
        : {})}
    >
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
          {s.tools.map((t) => {
            const isCall = callingTool === t;
            const isUsed = !isCall && usedTools.includes(t);
            const cls =
              "mcp-tool" +
              (isCall ? " mcp-tool-calling" : "") +
              (isUsed ? " mcp-tool-used" : "");
            return (
              <span className={cls} key={t}>{t}</span>
            );
          })}
        </div>
      )}
      {isMemory && (
        <div className="mcp-row-hint">👆 点击卡片查看 / 管理记忆</div>
      )}
    </div>
  );
}

/*
 * memory 服务器记忆查看/管理弹层：点击 mcp-panel 里的 memory 卡片即弹出。
 * 展示服务器里记录的全部记忆（key + value），每条可复制 / 删除；底部「新增记忆」
 * 表单可当场写入。数据来自 list_memories / save_memory / delete_memory 三个工具，
 * 优先用 list_memories 的 structuredContent.entries，旧版 Relay 则从文本回退解析。
 */
function parseMemoryText(text) {
  if (!text || text.includes("暂无记忆")) return [];
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^•\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) out.push({ key: m[1], value: m[2] });
  }
  return out;
}

function MemoryModal({ open, onClose, client }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [entries, setEntries] = useState([]);
  const [copiedKey, setCopiedKey] = useState(null);
  // 新增记忆表单
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [saving, setSaving] = useState(false);
  // 自动记忆捕获：开关 + 最近一次捕获结果（供状态行展示）
  const [autoOn, setAutoOn] = useState(isAutoMemoryEnabled());
  // 主动召回：开关（独立于自动捕获，控制回答前是否检索并注入长期记忆）
  const [recallOn, setRecallOn] = useState(isRecallEnabled());
  const [lastCap, setLastCap] = useState(null);

  // 监听捕获完成事件：刷新列表 + 更新「上次自动保存」状态行
  useEffect(() => {
    const onCap = (e) => {
      const d = (e && e.detail) || {};
      setLastCap({ saved: d.saved || 0, ts: d.ts || Date.now() });
      if (open) load();
    };
    const onCfg = (e) => setAutoOn(!!(e && e.detail && e.detail.enabled));
    window.addEventListener("jarvis:automem", onCap);
    window.addEventListener("jarvis:automem-config", onCfg);
    return () => {
      window.removeEventListener("jarvis:automem", onCap);
      window.removeEventListener("jarvis:automem-config", onCfg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleAuto = () => {
    const next = !autoOn;
    setAutoOn(next);
    setAutoMemoryEnabled(next);
  };

  const toggleRecall = () => {
    const next = !recallOn;
    setRecallOn(next);
    setRecallEnabled(next);
  };

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await client.callTool("list_memories", {});
      if (res.isError) {
        setErr(res.content || "读取失败");
        setEntries([]);
        return;
      }
      const ents =
        (res.raw && res.raw.structuredContent && res.raw.structuredContent.entries) ||
        parseMemoryText(res.content);
      setEntries(ents || []);
    } catch (e) {
      setErr(e && e.message ? e.message : "读取失败");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  // 打开时拉取一次
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const copy = async (key, value) => {
    try {
      await navigator.clipboard.writeText(`${key} = ${value}`);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch (_) {
      /* 剪贴板不可用时静默忽略 */
    }
  };

  const remove = async (key) => {
    try {
      await client.callTool("delete_memory", { key });
    } catch (_) {
      /* 失败也刷新一次看最新状态 */
    }
    load();
  };

  const save = async () => {
    const k = newKey.trim();
    const v = newVal;
    if (!k) return;
    setSaving(true);
    try {
      const res = await client.callTool("save_memory", { key: k, value: v });
      if (res.isError) {
        setErr(res.content || "保存失败");
      } else {
        setNewKey("");
        setNewVal("");
        load();
      }
    } catch (e) {
      setErr(e && e.message ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="mcp-mem-backdrop" onMouseDown={onClose}>
      <div
        className="mcp-mem-modal"
        role="dialog"
        aria-modal="true"
        aria-label="memory 记忆管理"
        data-dev-id="mcp-memory-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcp-mem-modal-head">
          <span className="mcp-mem-modal-title">🧠 memory · 已记录的记忆</span>
          <button
            type="button"
            className="mcp-mem-modal-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="mcp-mem-modal-body">
          <div className="mcp-mem-actions">
            <span className="mcp-mem-count">
              {entries.length} 条 · 持久化于 ~/.jarvis-mcp/memory.json
            </span>
            <button
              type="button"
              className="mcp-mem-refresh"
              onClick={load}
              disabled={loading}
              data-dev-id="mcp-memory-refresh"
            >
              ↻ 刷新
            </button>
          </div>

          <div className="mcp-mem-auto">
            <label className="mcp-mem-auto-row">
              <input
                type="checkbox"
                checked={autoOn}
                onChange={toggleAuto}
                data-dev-id="mcp-memory-auto-toggle"
              />
              <span>自动捕获对话中的记忆（每轮对话后提炼用户事实写入）</span>
            </label>
            <label className="mcp-mem-auto-row">
              <input
                type="checkbox"
                checked={recallOn}
                onChange={toggleRecall}
                data-dev-id="mcp-memory-recall-toggle"
              />
              <span>主动召回（回答前检索长期记忆并注入上下文）</span>
            </label>
            <div className="mcp-mem-lastcap">
              {lastCap
                ? `上次自动保存：${lastCap.saved} 条 · ${new Date(lastCap.ts).toLocaleTimeString("zh-CN")}`
                : "尚无自动捕获记录（发一条消息试试）"}
            </div>
          </div>

          {loading && <div className="mcp-mem-loading">读取中…</div>}
          {!loading && err && <div className="mcp-mem-empty err">⚠ {err}</div>}
          {!loading && !err && entries.length === 0 && (
            <div className="mcp-mem-empty">
              （暂无记忆）在下方「＋ 新增记忆」填入 key 与内容即可写入；也可让 J.A.R.V.I.S 在对话里调用 save_memory 自动记。
            </div>
          )}
          {!loading && !err && entries.length > 0 && (
            <ul className="mcp-mem-list">
              {entries.map((e) => (
                <li className="mcp-mem-item" key={e.key}>
                  <div className="mcp-mem-key">{e.key}</div>
                  <div className="mcp-mem-val">{e.value}</div>
                  <div className="mcp-mem-item-actions">
                    <button
                      type="button"
                      className="mcp-mem-copy"
                      onClick={() => copy(e.key, e.value)}
                      data-dev-id={`mcp-memory-copy-${e.key}`}
                    >
                      {copiedKey === e.key ? "✓" : "复制"}
                    </button>
                    <button
                      type="button"
                      className="mcp-mem-del"
                      onClick={() => remove(e.key)}
                      data-dev-id={`mcp-memory-del-${e.key}`}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mcp-mem-add">
            <div className="mcp-mem-add-title">＋ 新增记忆</div>
            <input
              className="mcp-mem-add-key"
              type="text"
              placeholder="key（如 project_name / 用户偏好）"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              data-dev-id="mcp-memory-add-key"
            />
            <textarea
              className="mcp-mem-add-val"
              placeholder="value（要记下来的内容，可多行）"
              value={newVal}
              onChange={(e) => setNewVal(e.target.value)}
              rows={3}
              data-dev-id="mcp-memory-add-val"
            />
            <button
              type="button"
              className="mcp-mem-add-save"
              onClick={save}
              disabled={saving || !newKey.trim()}
              data-dev-id="mcp-memory-add-save"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function McpPanel({ open, onClose }) {
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const clientRef = useRef(null);
  if (!clientRef.current) clientRef.current = new MCPClient();
  const [memOpen, setMemOpen] = useState(false);
  // 呼吸灯：记录当前正在调用的工具名（瞬时）
  const [callingTool, setCallingTool] = useState(null);
  // 本轮会话「已调用过的工具」集合：会话期间持续呼吸灯，至下次会话开始清空
  const [usedTools, setUsedTools] = useState([]);

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

  // 呼吸灯：监听 MCP 工具调用开始/结束 + 聊天会话边界
  useEffect(() => {
    const onStart = (e) => {
      const name = (e && e.detail && e.detail.name) || null;
      if (!name) return;
      setCallingTool(name);
      // 记入本轮「已用工具」集合（不随调用结束移除 → 持续呼吸灯）
      setUsedTools((prev) => (prev.includes(name) ? prev : [...prev, name]));
    };
    const onEnd = (e) => {
      const name = (e && e.detail && e.detail.name) || null;
      setCallingTool((prev) => (prev === name ? null : prev));
    };
    // 会话开始 / 结束：清空「已用工具」集合，使呼吸灯重置
    const onSessionStart = () => {
      setUsedTools([]);
      setCallingTool(null);
    };
    const onSessionEnd = () => setUsedTools([]);
    window.addEventListener("jarvis:mcp-tool-start", onStart);
    window.addEventListener("jarvis:mcp-tool-end", onEnd);
    window.addEventListener("jarvis:chat-session-start", onSessionStart);
    window.addEventListener("jarvis:chat-session-end", onSessionEnd);
    return () => {
      window.removeEventListener("jarvis:mcp-tool-start", onStart);
      window.removeEventListener("jarvis:mcp-tool-end", onEnd);
      window.removeEventListener("jarvis:chat-session-start", onSessionStart);
      window.removeEventListener("jarvis:chat-session-end", onSessionEnd);
    };
  }, []);

  // 调用中的工具若落在 .mcp-body 可视区之外，平滑滚动使其进入视野（呼吸灯随之闪烁）
  useEffect(() => {
    if (!callingTool) return;
    const body = bodyRef.current;
    if (!body) return;
    const el = body.querySelector(".mcp-tool-calling");
    if (!el) return;
    const br = body.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const fullyVisible = er.top >= br.top && er.bottom <= br.bottom;
    if (!fullyVisible) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [callingTool]);

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

      <div className="mcp-body" ref={bodyRef}>
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
          <McpRow
            s={s}
            key={s.name}
            client={clientRef.current}
            onOpenMemory={s.name === "memory" ? () => setMemOpen(true) : undefined}
            callingTool={callingTool}
            usedTools={usedTools}
          />
        ))}
      </div>
      <MemoryModal
        open={memOpen}
        onClose={() => setMemOpen(false)}
        client={clientRef.current}
      />
    </div>,
    document.body
  );
}
