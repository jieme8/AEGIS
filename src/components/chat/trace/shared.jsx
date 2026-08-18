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
