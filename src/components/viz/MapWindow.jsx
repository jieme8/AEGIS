import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hasAmapKey, loadAmap, buildMap } from "../../lib/amapJsApi.js";

// 独立「地图窗口」：经 Portal 挂到 body，不受聊天面板限制，可在整页任意拖动。
// 与主对话解耦 —— 地图结果不再写进 chat-panel，而是由 useChatController 通过事件推流进来：
//   jarvis:map-start  → 新建「加载中」卡片（骨架 + 地址文本）
//   jarvis:map-ready  → 地图就绪（坐标/路线 → 高德 JS API 渲染）
//   jarvis:map-error  → 失败态（降级为坐标文本）
//
// 每张地图卡片内部用 IntersectionObserver 懒加载高德 JS API 实例，
// 同一窗口内多张卡片各自独立 Map 实例、自动 fitBounds。

function MapCard({ item }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null); // AMap.Map 实例（用于卸载销毁）
  const resizeObserverRef = useRef(null); // 监听容器尺寸变化，触发地图重算
  const [status, setStatus] = useState("loading"); // loading | ready | error | text-only

  // 懒加载 + 地图创建
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 之前因无 Key B 降级为 text-only，现在 Key 来了 → 切回 loading 重新加载
    if (item.hasJsKey && status === "text-only") {
      setStatus("loading");
      return;
    }

    // 无 Key B → 降级为文本模式
    if (!item.hasJsKey) {
      setStatus("text-only");
      return;
    }

    // 已就绪 / 已启动则不再重复
    if (status === "ready" || mapRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !mapRef.current && status === "loading") {
          initMap();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);

    // 若已在视口内，Observer 不一定立即触发，手动启动一次
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0 && status === "loading" && !mapRef.current) {
      initMap();
    }

    return () => observer.disconnect();

    async function initMap() {
      if (mapRef.current) return;
      try {
        // buildMap 内部处理：loadAmap → 创建地图 → 标记点 + 路线 + fitView
        const map = await buildMap(
          el,
          item.markers || [],
          (item.route && item.route.path) || null
        );
        if (!el.isConnected) return; // 已卸载
        mapRef.current = map;
        setStatus("ready");
        // 容器尺寸/布局可能晚于地图创建生效，强制重算视口，避免瓦片尺寸为 0 导致黑屏
        const doResize = () => { try { map.resize(); } catch (_) {} };
        requestAnimationFrame(doResize);
        const ro = new ResizeObserver(doResize);
        ro.observe(el);
        resizeObserverRef.current = ro;
      } catch (e) {
        console.warn("[MapWindow] 地图初始化失败:", e);
        setStatus("error");
      }
    }
  }, [item, status]);

  // 卸载时销毁地图实例
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      const m = mapRef.current;
      mapRef.current = null;
      // 关键：高德 map.destroy() 会移除 .mw-map-canvas 容器自身，若与 React 的
      // removeChild 同帧执行会竞争导致 "node is not a child" 整页崩溃。
      // 故延迟到 React 完成 DOM 删除后再销毁，且 try/catch 兜底。
      if (m) {
        setTimeout(() => { try { m.destroy(); } catch (_) {} }, 0);
      }
    };
  }, []);

  // 文本降级模式（无 Key B 或加载失败）
  if (status === "text-only" || status === "error") {
    return (
      <div className="mw-card mw-card--text">
        <div className="mw-card-label">{item.label || "位置标注"}</div>
        <ul className="mw-card-list">
          {item.markers?.map((m, i) => (
            <li key={i}>
              {m.label} · {m.lng.toFixed(6)}, {m.lat.toFixed(6)}
            </li>
          )) || <li>{item.label || "位置信息"}</li>}
        </ul>
        {status === "error" && (
          <div className="mw-card-hint">地图加载失败，显示坐标降级</div>
        )}
      </div>
    );
  }

  return (
    <div className="mw-card">
      <div className="mw-card-label">{item.label || "位置标注"}</div>
      {/* loading 必须与 .mw-map-canvas 平级（不能作为子节点），因为高德 new AMap.Map
          会清空容器，把 React 管理的 loading 节点删掉，导致后续 removeChild 崩溃。 */}
      <div className="mw-map-wrap">
        <div className="mw-map-canvas" ref={containerRef} />
        {status === "loading" && (
          <div className="mw-loading">
            <span className="mw-spinner" />
            <span>加载地图…</span>
          </div>
        )}
      </div>
      {(item.markers?.length > 0) && (
        <div className="mw-card-meta">
          {item.markers.map((m, i) => (
            <span key={i} className="mw-marker-tag">
              {m.label || `点${i + 1}`}
            </span>
          ))}
          {item.route && <span className="mw-route-tag">路线</span>}
        </div>
      )}
    </div>
  );
}

export function MapWindow({ open, onClose }) {
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [items, setItems] = useState([]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const b = bodyRef.current;
      if (b) b.scrollTop = b.scrollHeight;
    });
  }

  // 事件桥：upsert 式更新地图列表（同 id 覆盖，避免重复卡片）
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
      upsert(e.detail, {
        status: "loading",
        label: e.detail.label || "定位中…",
        hasJsKey: e.detail.hasJsKey ?? false,
      });
      scrollToBottom();
    };
    const onReady = (e) =>
      upsert(e.detail, {
        status: "ready",
        label: e.detail.label || "位置标注",
        markers: e.detail.markers || [],
        route: e.detail.route || null,
        hasJsKey: e.detail.hasJsKey ?? false,
      });
    const onError = (e) =>
      upsert(e.detail, {
        status: "error",
        label: e.detail.label || "位置标注",
        markers: e.detail.markers || [],
        hasJsKey: false,
      });

    window.addEventListener("jarvis:map-start", onStart);
    window.addEventListener("jarvis:map-ready", onReady);
    window.addEventListener("jarvis:map-error", onError);
    return () => {
      window.removeEventListener("jarvis:map-start", onStart);
      window.removeEventListener("jarvis:map-ready", onReady);
      window.removeEventListener("jarvis:map-error", onError);
    };
  }, []);

  // 新增卡片时贴底
  useEffect(() => {
    scrollToBottom();
  }, [items]);

  // 标题栏拖动（与 ImageWindow / McpPanel 同款）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".mw-close")) return;
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

  // 底部 resize
  const onResizePointerDown = (e) => {
    const box = boxRef.current;
    if (!box) return;
    const startY = e.clientY;
    const origH = box.offsetHeight;
    setResizing(true);
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      const newH = Math.max(220, Math.min(window.innerHeight - 100, origH + dy));
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

  const readyCount = items.filter((i) => i.status === "ready").length;
  const pendingCount = items.filter((i) => i.status === "loading").length;

  return createPortal(
    <div
      ref={boxRef}
      className={"map-window" + (dragging ? " dragging" : "") + (resizing ? " resizing" : "")}
      role="dialog"
      aria-label="地图窗口"
      data-dev-id="map-window"
    >
      <div className="mw-head" onPointerDown={onHeadPointerDown}>
        <span className="mw-title">地图</span>
        <span className="mw-count">
          {readyCount} 张{pendingCount ? ` · ${pendingCount} 加载中` : ""}
        </span>
        <button className="mw-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="mw-body" ref={bodyRef}>
        {items.length === 0 && (
          <div className="mw-empty">
            <svg className="mw-empty-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M32 6 C18 6 8 16 8 28 C8 42 32 58 32 58 C32 58 56 42 56 28 C56 16 46 6 32 6Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx="32" cy="27" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <line x1="32" y1="34" x2="32" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div className="mw-empty-title">暂无地图</div>
            <div className="mw-empty-hint">
              当对话中包含地址或位置信息时，<br />
              地图会自动出现在这里。
            </div>
          </div>
        )}

        {items.map((it) => (
          <MapCard key={it.id} item={it} />
        ))}
      </div>

      <div className="mw-resize" onPointerDown={onResizePointerDown} title="拖动调整高度" />
    </div>,
    document.body
  );
}
