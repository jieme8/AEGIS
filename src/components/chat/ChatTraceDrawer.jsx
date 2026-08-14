import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MODEL_CONFIG } from "../../config/modelConfig.js";

/*
 * 模型对话过程展示组件（独立浮层，挂载到 document.body，不受任何父容器限制）
 * 可在整个页面任意拖动；默认锚定视口右上角，拖动后可落于任意位置。
 * 在 AI 对话发起瞬间由控制器自动弹出（open=true），无需按钮触发。
 * 可视化一次对话请求的完整流水线：
 *   01 请求状态  · 02 附加上下文  · 03 实际提示词  · 04 思考过程  · 05 流式回复
 * 各分区可展开/折叠，含加载状态提示与流式平滑展示，浮层本身可拖动。
 */

const STATUS_META = {
  sending:   { label: "请求已发送",   cls: "pending" },
  streaming: { label: "流式输出中",   cls: "active" },
  done:      { label: "已完成",       cls: "done" },
  fallback:  { label: "本地模拟回复", cls: "warn" },
  error:     { label: "请求失败",     cls: "err" },
};

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="trace-copy"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text || "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch (e) { /* 剪贴板不可用时静默 */ }
      }}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function LoadingDots({ label }) {
  return (
    <div className="trace-loading">
      <span className="tdot" /><span className="tdot" /><span className="tdot" />
      <span className="trace-loading-label">{label}</span>
    </div>
  );
}

// 组件 ID 标签点击复制（与 dev 覆盖层 toast 复用同一元素）
function copyDevId(id) {
  const done = () => {
    const toast = document.getElementById("devToast");
    if (toast) {
      toast.textContent = "已复制 ✓ " + id;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1300);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(done, done);
  } else {
    done();
  }
}

export function ChatTraceDrawer({ trace, open, onClose }) {
  const boxRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // ESC 关闭（浮层不模态，仅作为便利快捷键）
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 标题栏拖动：浮层为 body 级独立元素，可在整个页面任意拖动（仅做视口边界收拢，避免拖出屏幕丢失）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".trace-close")) return; // 点击关闭按钮不触发拖动
    const box = boxRef.current;
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const origLeft = box.offsetLeft, origTop = box.offsetTop;
    box.style.right = "auto"; // 改用 left 驱动，覆盖默认 right 锚点
    setDragging(true);
    box.style.userSelect = "none";

    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const maxLeft = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - box.offsetHeight);
      const left = Math.max(0, Math.min(origLeft + dx, maxLeft));
      const top = Math.max(0, Math.min(origTop + dy, maxTop));
      box.style.left = left + "px";
      box.style.top = top + "px";
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

  const meta = (trace && STATUS_META[trace.status]) || STATUS_META.sending;
  const t = trace || {};
  const ctx = t.context || {};
  const prompt = t.prompt || {};
  const reply = t.reply || {};
  const streaming = t.status === "streaming" || t.status === "sending";
  const hasReasoning = !!(reply.reasoning && reply.reasoning.length);
  const history = ctx.history || [];

  return createPortal(
    <div
      ref={boxRef}
      className={`trace-float${dragging ? " dragging" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label="模型对话过程"
      data-dev-id="trace-float"
    >
      <div className="trace-head" onPointerDown={onHeadPointerDown}>
        <span className="trace-title">模型对话过程 · TRACE</span>
        <span className={`trace-status ${meta.cls}`}>
          <span className="trace-dot" />
          {meta.label}
        </span>
        <button className="trace-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
      </div>

      <div className="trace-body">
        {/* 01 · 请求状态 */}
        <details className="trace-section" open>
          <summary><span className="sec-idx">01</span> 请求状态</summary>
          <div className="trace-sec-body">
            <div className="panel trace-kv">
              <div className="k">状态</div>
              <div className={`v ${meta.cls}`}>{meta.label}</div>
              <div className="k">模型</div>
              <div className="v mag">{t.model || MODEL_CONFIG.model}</div>
              <div className="k">模式</div>
              <div className="v">{t.mode === "local" ? "本地模拟（接口失败回退）" : "真实大模型 · LongCat"}</div>
              <div className="k">发送时间</div>
              <div className="v">{fmtTime(t.sentAt)}</div>
            </div>
            {streaming && (
              <LoadingDots label={t.status === "sending" ? "已发送，等待模型首个 token…" : "正在接收流式输出…"} />
            )}
          </div>
        </details>

        {/* 02 · 附加上下文 */}
        <details className="trace-section">
          <summary><span className="sec-idx">02</span> 附加上下文</summary>
          <div className="trace-sec-body">
            <div className="trace-sub">历史对话（最近 {history.length} 轮，实际随请求发送）</div>
            <div className="trace-hist">
              {history.length === 0 && <div className="trace-empty">（无历史）</div>}
              {history.map((m, i) => (
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

        {/* 03 · 实际提示词 */}
        <details className="trace-section">
          <summary><span className="sec-idx">03</span> 提示词</summary>
          <div className="trace-sec-body">
            <div className="trace-sub">
              System Prompt
              <CopyButton text={prompt.system || ""} />
            </div>
            <pre className="trace-code">{prompt.system || "（空）"}</pre>

            <div className="trace-sub">
              完整 Messages（实际发送给模型的请求体）
              <CopyButton text={JSON.stringify(prompt.messages || [], null, 2)} />
            </div>
            <pre className="trace-code">{JSON.stringify(prompt.messages || [], null, 2)}</pre>
          </div>
        </details>

        {/* 04 · 思考过程（独立分区，置于提示词与流式回复之间） */}
        <details className="trace-section" open>
          <summary><span className="sec-idx">04</span> 思考过程</summary>
          <div className="trace-sec-body">
            {hasReasoning ? (
              <pre className="trace-code">{reply.reasoning}</pre>
            ) : streaming ? (
              <LoadingDots label="模型思考中…" />
            ) : (
              <div className="trace-empty">（无思考过程 / reasoning_content 为空）</div>
            )}
          </div>
        </details>

        {/* 05 · 流式回复 */}
        <details className="trace-section" open>
          <summary><span className="sec-idx">05</span> 流式回复</summary>
          <div className="trace-sec-body">
            {streaming && !reply.text ? (
              <LoadingDots label="等待模型首个 token…" />
            ) : (
              <div className="trace-reply">
                {reply.text}
                {streaming && <span className="trace-cursor" aria-hidden="true" />}
              </div>
            )}
          </div>
        </details>
      </div>

      {/* 组件 ID 标签：dev 模式下显示、可点击复制；置于最后子节点，重渲染安全 */}
      <span className="dev-label" data-copy-id="trace-float" onClick={() => copyDevId("trace-float")}>
        <span className="dl-id">trace-float</span>
        <span className="dl-coord" />
      </span>
    </div>,
    document.body
  );
}
