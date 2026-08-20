import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { imageProviderManager } from "../../lib/imageProviderManager.js";
import { isCompactViewport } from "../../lib/viewport.js";

// 独立「AI 配图窗口」：经 Portal 挂到 body，不受聊天面板限制，可在整页任意拖动。
// 与主对话解耦 —— 生图结果不再写进 chat-panel，而是由 imagePipeline 通过事件推流进来：
//   jarvis:image-start   → 新建「生成中」卡片（动画骨架 + 提示词占位）
//   jarvis:image-prompt  → 提示词就绪即填入（生图进行中即可见）
//   jarvis:image-ready   → 出图，替换骨架
//   jarvis:image-error   → 失败态 + 重试
// 重生成由内部按钮派发 jarvis:image-regen { id }，imagePipeline 持有对应 regen 闭包。

function downloadImage(url, prompt) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "jarvis-image-" + Date.now() + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    /* 忽略 */
  }
}

async function copyPrompt(prompt) {
  try {
    await navigator.clipboard.writeText(prompt);
    return true;
  } catch (e) {
    return false;
  }
}

function openLightbox(url, prompt, meta) {
  let ov = document.getElementById("imgLightbox");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "imgLightbox";
    ov.className = "img-lightbox";
    ov.setAttribute("data-dev-id", "img-lightbox");
    document.body.appendChild(ov);
    // 仅点击遮罩背景本身（非内容区）才关闭
    ov.addEventListener("click", (e) => {
      if (e.target === ov) ov.classList.remove("open");
    });
    // ESC 关闭灯箱
    ov._onKey = (e) => {
      if (e.key === "Escape") ov.classList.remove("open");
    };
    document.addEventListener("keydown", ov._onKey);
  }
  ov.innerHTML = "";
  const fig = document.createElement("div");
  fig.className = "img-lightbox-fig";
  fig.setAttribute("data-dev-id", "lb-fig");
  const img = document.createElement("img");
  img.src = url;
  img.alt = prompt || "";
  img.setAttribute("data-dev-id", "lb-img");
  const cap = document.createElement("div");
  cap.className = "img-lightbox-cap";
  cap.setAttribute("data-dev-id", "lb-cap");
  const metaLine = [meta && meta.model, meta && meta.revised_prompt].filter(Boolean).join(" · ");
  const overlayText = meta && meta.overlayText;

  const title = document.createElement("div");
  title.textContent = prompt || "AI 生成配图";
  title.setAttribute("data-dev-id", "lb-title");
  cap.appendChild(title);

  if (metaLine) {
    const metaEl = document.createElement("div");
    metaEl.className = "lb-meta";
    metaEl.textContent = metaLine;
    metaEl.setAttribute("data-dev-id", "lb-meta");
    cap.appendChild(metaEl);
  }
  if (overlayText) {
    const ovPre = document.createElement("pre");
    ovPre.className = "lb-overlay";
    ovPre.textContent = overlayText;
    ovPre.setAttribute("data-dev-id", "lb-overlay");
    cap.appendChild(ovPre);
  }

  fig.appendChild(img);
  fig.appendChild(cap);
  ov.appendChild(fig);
  ov.classList.add("open");
}

// 提示词块（生成中 / 已出图 共用）：标题 + 复制 + 可滚动正文
function PromptBlock({ prompt, source, id, copiedId, onCopy }) {
  return (
    <div className="iw-prompt-wrap">
      <div className="iw-prompt-head">
        <span className="iw-prompt-label">
          生图提示词{source ? ` · ${source}` : ""}
        </span>
        {prompt && (
          <button
            type="button"
            className="iw-act iw-copy-prompt"
            onClick={onCopy}
            data-dev-id="iw-copy-prompt"
          >
            {copiedId === id ? "已复制" : "复制"}
          </button>
        )}
      </div>
      <div className="iw-prompt" title={prompt || ""}>
        {prompt || "准备提示词…"}
      </div>
    </div>
  );
}

export function ImageWindow({ open, onClose }) {
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [items, setItems] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const b = bodyRef.current;
      if (b) b.scrollTop = b.scrollHeight;
    });
  }

  // 事件桥：upsert 式更新画廊（同 id 覆盖，避免重复卡片）
  useEffect(() => {
    const upsert = (detail, patch) => {
      setItems((prev) => {
        const idx = prev.findIndex((it) => it.id === detail.id);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = { ...copy[idx], ...patch };
          return copy;
        }
        return [...prev, { id: detail.id, status: "pending", ...patch }];
      });
    };
    const onStart = (e) => {
      upsert(e.detail, { status: "pending" });
      scrollToBottom();
    };
    // 提示词就绪即显示（生成进行中），不等待出图
    const onPrompt = (e) => upsert(e.detail, { prompt: e.detail.prompt, source: e.detail.source });
    const onReady = (e) =>
      upsert(e.detail, {
        status: "ready",
        url: e.detail.url,
        prompt: e.detail.prompt,
        meta: e.detail.meta,
        model: e.detail.model,
        source: e.detail.source,
      });
    const onError = (e) => upsert(e.detail, { status: "error", message: e.detail.message });

    window.addEventListener("jarvis:image-start", onStart);
    window.addEventListener("jarvis:image-prompt", onPrompt);
    window.addEventListener("jarvis:image-ready", onReady);
    window.addEventListener("jarvis:image-error", onError);
    return () => {
      window.removeEventListener("jarvis:image-start", onStart);
      window.removeEventListener("jarvis:image-prompt", onPrompt);
      window.removeEventListener("jarvis:image-ready", onReady);
      window.removeEventListener("jarvis:image-error", onError);
    };
  }, []);

  // 画廊内容变化（新增卡片 / 出图 / 失败）时始终贴底，滚动条默认在最下面
  useEffect(() => {
    scrollToBottom();
  }, [items]);

  // 标题栏拖动（与 McpPanel 同款：浮层为 body 级元素，全页可拖）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".iw-close")) return;
    const box = boxRef.current;
    if (!box) return;
    const startX = e.clientX,
      startY = e.clientY;
    const origLeft = box.offsetLeft,
      origTop = box.offsetTop;
    box.style.right = "auto";
    setDragging(true);
    box.style.userSelect = "none";
    const onMove = (ev) => {
      const dx = ev.clientX - startX,
        dy = ev.clientY - startY;
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

  // 底部 resize 拖拽：调整窗口高度
  const onResizePointerDown = (e) => {
    const box = boxRef.current;
    if (!box) return;
    const startY = e.clientY;
    const origH = box.offsetHeight;
    setResizing(true);
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      const newH = Math.max(200, Math.min(window.innerHeight - 100, origH + dy));
      box.style.height = newH + "px";
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  if (!open) return null;

  const done = items.filter((i) => i.status === "ready").length;
  const pending = items.filter((i) => i.status === "pending").length;

  const regen = (id) =>
    window.dispatchEvent(new CustomEvent("jarvis:image-regen", { detail: { id } }));

  const onCopyPrompt = (it) => async () => {
    if (!it.prompt) return;
    const ok = await copyPrompt(it.prompt);
    if (ok) {
      setCopiedId(it.id);
      setTimeout(() => setCopiedId((c) => (c === it.id ? null : c)), 1200);
    }
  };

  return createPortal(
    <div
      ref={boxRef}
      className={"image-window" + (isCompactViewport() ? " compact" : "") + (dragging ? " dragging" : "") + (resizing ? " resizing" : "")}
      role="dialog"
      aria-label="AI 配图窗口"
      data-dev-id="image-window"
    >
      <div className="iw-head" onPointerDown={onHeadPointerDown}>
        <span className="iw-title">AI 配图窗口</span>
        <span className="iw-count">
          {done} 张{pending ? ` · ${pending} 生成中` : ""}
        </span>
        <button className="iw-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="iw-body" ref={bodyRef}>
        {items.length === 0 && (
          <div className="iw-empty">
            <div className="iw-empty-orbit" aria-hidden="true">
              <span className="iw-ring" />
              <span className="iw-ring r2" />
              <span className="iw-ring r3" />
              <span className="iw-sweep" />
              <span className="iw-core" />
            </div>
            <div className="iw-empty-title">配图缓冲区 · 待机中</div>
            <div className="iw-empty-status">// STANDBY — 等待值得生图的内容信号</div>
          </div>
        )}

        {items.map((it) => (
          <div className="iw-card" key={it.id} data-dev-id="iw-card">
            {/* 生成中：动画骨架 + 旋转指示器 + 实时提示词 */}
            {it.status === "pending" && (
              <div className="iw-pending">
                <div className="iw-skeleton">
                  <div className="iw-skeleton-shine" />
                </div>
                <div className="iw-gen-status">
                  <span className="iw-spinner" />
                  <span className="iw-gen-text">正在生成配图</span>
                  <span className="iw-gen-model">{imageProviderManager.getActive()?.label || "生图模型"}</span>
                </div>
                <PromptBlock
                  prompt={it.prompt}
                  source={it.source}
                  id={it.id}
                  copiedId={copiedId}
                  onCopy={onCopyPrompt(it)}
                />
              </div>
            )}

            {it.status === "error" && (
              <div className="iw-error">
                <div className="iw-error-msg">配图生成失败：{it.message}</div>
                <button
                  type="button"
                  className="iw-act"
                  onClick={() => regen(it.id)}
                  data-dev-id="iw-retry"
                >
                  重试
                </button>
              </div>
            )}

            {it.status === "ready" && (
              <>
                <img
                  className="iw-img"
                  src={it.url}
                  alt={it.prompt || "AI 生成配图"}
                  loading="lazy"
                  onClick={() => openLightbox(it.url, it.prompt, it.meta)}
                  data-dev-id="iw-img"
                />
                <div className="iw-meta">
                  <span className="iw-model">
                    {(it.meta && it.meta.model) || it.model || "AI"}
                  </span>
                </div>
                <PromptBlock
                  prompt={it.prompt}
                  source={it.source}
                  id={it.id}
                  copiedId={copiedId}
                  onCopy={onCopyPrompt(it)}
                />
                <div className="iw-bar">
                  <button
                    type="button"
                    className="iw-act"
                    onClick={() => regen(it.id)}
                    data-dev-id="iw-regen"
                  >
                    重生成
                  </button>
                  <button
                    type="button"
                    className="iw-act"
                    onClick={() => downloadImage(it.url, it.prompt)}
                    data-dev-id="iw-download"
                  >
                    下载
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="iw-resize" onPointerDown={onResizePointerDown} title="拖动调整高度" />
    </div>,
    document.body
  );
}
