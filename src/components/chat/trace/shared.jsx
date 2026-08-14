import { useState } from "react";
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
