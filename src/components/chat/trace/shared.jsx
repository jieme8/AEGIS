import { useEffect, useRef, useState } from "react";
import { MODEL_CONFIG } from "../../../config/modelConfig.js";

// ---- 状态元数据（供 01 请求状态使用）----
export const STATUS_META = {
  sending:   { label: "请求已发送",   cls: "pending" },
  streaming: { label: "流式输出中",   cls: "active" },
  done:      { label: "已完成",       cls: "done" },
  fallback:  { label: "本地模拟回复", cls: "warn" },
  error:     { label: "请求失败",     cls: "err" },
};

// ---- MCP 工具状态元数据（供 06 工具调用使用）----
export const MCP_STATUS = {
  pending:     { label: "等待工具",       cls: "pending" },
  running:     { label: "工具执行中",     cls: "active" },
  ok:          { label: "工具调用完成",   cls: "done" },
  unavailable: { label: "MCP 不可用（已降级）", cls: "warn" },
  error:       { label: "MCP 错误",       cls: "err" },
};

/**
 * 让浮层标题栏的「动态效果（呼吸 + 流光）」只在内容真正更新时出现：
 *   - 打开瞬间（首次渲染）不脉冲，避免空内容/挂载即闪；
 *   - 仅当「内容签名」变化且确有内容时才加 alive，3.7s 后自动消失；
 *   - 流式更新期间签名频繁变化 → 计时器不断重置 → 持续脉冲，停更后自然收尾。
 * @param {string} signature 可序列化内容指纹（变化即视为更新）
 * @param {boolean} hasContent 当前是否确有内容（无内容不脉冲）
 */
export function useContentPulse(signature, hasContent) {
  const [alive, setAlive] = useState(false);
  const timer = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }   // 挂载首帧不脉冲
    if (!hasContent) return;
    setAlive(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAlive(false), 3700);
  }, [signature, hasContent]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return alive;
}

/**
 * 打字机钩子：目标文本变化时以「逐字揭示」效果输出。
 *   - 纯追加（新文本以当前已显示内容为前缀）：仅把新增尾部逐字打出，旧内容不重打；
 *   - 非追加（结构变化 / 首次 / 清空）：整体从头逐字打出。
 * 速度按文本长度自适应（整体约 ~2.5s 完成），短追加则更短。
 * @param {string} fullText 目标完整文本
 * @param {object} [opts] { onTick?: 每次更新后回调（用于滚动贴底）, speed?: 强制每帧字符数 }
 * @returns {string} 当前已揭示的文本
 */
export function useTypewriter(fullText, opts = {}) {
  const { onTick, speed } = opts;
  const [displayed, setDisplayed] = useState("");
  const shownRef = useRef("");
  const timer = useRef(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const target = fullText || "";
    const current = shownRef.current;
    let startIdx;
    if (target.startsWith(current) && current.length > 0) {
      startIdx = current.length;            // 纯追加：从新增处继续
    } else {
      setDisplayed("");                     // 非追加：从头打
      startIdx = 0;
    }
    shownRef.current = target;
    if (startIdx >= target.length) {
      setDisplayed(target);
      if (onTickRef.current) onTickRef.current();
      return;
    }
    const step = speed || Math.max(2, Math.ceil(target.length / 160));
    let i = startIdx;
    timer.current = setInterval(() => {
      i = Math.min(target.length, i + step);
      setDisplayed(target.slice(0, i));
      if (onTickRef.current) onTickRef.current();
      if (i >= target.length) { clearInterval(timer.current); timer.current = null; }
    }, 16);
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [fullText, speed]);

  return displayed;
}


// ---- 格式化时间戳 ----
export function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ---- 复制按钮（各子块共用）----
export function CopyButton({ text }) {
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

// ---- 加载动画（各子块共用）----
export function LoadingDots({ label }) {
  return (
    <div className="trace-loading">
      <span className="tdot" /><span className="tdot" /><span className="tdot" />
      <span className="trace-loading-label">{label}</span>
    </div>
  );
}

// ---- 空数据时的动画待机态（各 trace 浮层共用，带动态效果）----
// variant: 不传=默认(青) | "muted"=未启用(暗青) | "warn"=异常(琥珀)
export function TraceIdle({ title, sub, variant }) {
  return (
    <div className={"trace-idle" + (variant ? " " + variant : "")}>
      <div className="tidle-orbit" aria-hidden="true">
        <span className="tidle-ring" />
        <span className="tidle-ring r2" />
        <span className="tidle-sweep" />
        <span className="tidle-core" />
      </div>
      <div className="tidle-title">{title}</div>
      {sub && <div className="tidle-sub">{sub}</div>}
    </div>
  );
}

// ---- dev 标签点击复制 ----
export function copyDevId(id) {
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
