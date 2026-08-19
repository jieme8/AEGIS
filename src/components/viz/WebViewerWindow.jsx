import { useEffect, useState } from "react";
import { FloatingPanel } from "../common/FloatingPanel.jsx";

// 独立「网页查看器」浮层：复用 FloatingPanel（Portal 挂 body、可拖拽、带 devId）。
// 约定：一个窗口只装一个网页。再来一个网页 → 在 App 层再弹出一个新窗口（多实例）。
// 窗口仅含标题栏 + 关闭 + iframe，无地址栏 / 刷新 / 在浏览器打开等控件；
// 打开网址的来源是：AI 回复链接、AI 自动提取、或任务栏「网页」按钮（prompt 输入）。
// 开窗带黑客风扫描揭幕动画。

function hostOf(u) {
  try {
    return new URL(u).host || u;
  } catch {
    return u;
  }
}

// 通过 vite 同源代理加载，绕过目标站的 X-Frame-Options / CSP frame-ancestors 限制
function proxied(u) {
  return "/api/webproxy?url=" + encodeURIComponent(u);
}

export function WebViewerWindow({ devId, url, open, onClose, pos }) {
  const [booting, setBooting] = useState(false);

  // url 变化 / 开窗 → 揭幕动画（黑客风扫描线）
  useEffect(() => {
    if (!open || !url) return;
    setBooting(true);
    const t = setTimeout(() => setBooting(false), 680);
    return () => clearTimeout(t);
  }, [url, open]);

  return (
    <FloatingPanel
      devId={devId}
      title={hostOf(url) || "网页查看器"}
      defaultPos={pos || { x: 410, y: 120 }}
      width={320}
      height={550}
      open={open}
      onClose={onClose}
      headExtra={
        <button
          className="wv-head-open"
          type="button"
          title="在浏览器打开"
          onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
        >↗</button>
      }
    >
      <div className="wv-frame-wrap">
        {url ? (
          <iframe
            id="wv-frame"
            key={url}
            className="wv-frame"
            src={proxied(url)}
            title={url}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="wv-empty">无网址</div>
        )}
        {booting && (
          <div className="wv-boot" aria-hidden="true">
            <div className="wv-boot-scan" />
            <div className="wv-boot-text">ESTABLISHING LINK · 解析页面…</div>
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
