import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildMap, buildMultiMap } from "../../lib/amapJsApi.js";

// 独立「地图窗口」：经 Portal 挂到 body，不受聊天面板限制，可在整页任意拖动。
// 与主对话解耦 —— 地图结果不再写进 chat-panel，而是由 useChatController 通过事件推流进来：
//   jarvis:map-start  → 新建「加载中」卡片（骨架 + 地址文本）
//   jarvis:map-ready  → 地图就绪（坐标/路线 → 高德 JS API 渲染）
//   jarvis:map-error  → 失败态（降级为坐标文本）
//
// 每张地图卡片内部用 IntersectionObserver 懒加载高德 JS API 实例，
// 同一窗口内多张卡片各自独立 Map 实例、自动 fitBounds。
// 点击任意卡片地图 → 全屏「地图总览」：聚合窗口内所有卡片的标记 + 路线。

// 全屏地图总览：仿 img-lightbox（fixed inset:0 / z-index:9999 / 暗色模糊底）
// 渲染窗口内「所有卡片」的全部标记 + 全部路线；右侧列出每处坐标 / 路线。
// 点击遮罩或按 ESC 关闭。
function MapDetailLightbox({ items, onClose }) {
  const canvasRef = useRef(null);
  const mapDataRef = useRef(null); // {map, markers, polylines}
  const resizeObserverRef = useRef(null);
  const [built, setBuilt] = useState(false);
  const [builtErr, setBuiltErr] = useState(false);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 聚合地图：把所有卡片的标记 + 路线画在同一张图上
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || mapDataRef.current) return;
    let cancelled = false;
    buildMultiMap(el, items)
      .then((data) => {
        if (cancelled || !el.isConnected) {
          try { data.map.destroy(); } catch (_) {}
          return;
        }
        mapDataRef.current = data;
        setBuilt(true);
        const { map } = data;
        const doResize = () => { try { map.resize(); } catch (_) {} };
        requestAnimationFrame(doResize);
        const ro = new ResizeObserver(doResize);
        ro.observe(el);
        resizeObserverRef.current = ro;
      })
      .catch((e) => {
        console.warn("[MapDetailLightbox] 全景地图初始化失败:", e);
        if (!cancelled) setBuiltErr(true);
      });
    return () => { cancelled = true; };
  }, [items]);

  // 卸载时销毁地图实例（延迟 + try/catch，避免与 React removeChild 竞争）
  useEffect(() => () => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    const data = mapDataRef.current;
    mapDataRef.current = null;
    if (data && data.map) setTimeout(() => { try { data.map.destroy(); } catch (_) {} }, 0);
  }, []);

  const hasGeo = items.some((it) => (it.markers && it.markers.length) || it.route);

  // 点击右侧列表 → 地图聚焦到对应标记（居中 + 放大 + 弹跳高亮）
  const focusTo = (coord) => {
    const { map, markers } = mapDataRef.current || {};
    if (!map) return;
    map.setCenter([coord.lng, coord.lat]);
    map.setZoom(15);
    const mk = markers.find((m) =>
      Math.abs(m.lng - coord.lng) < 1e-5 && Math.abs(m.lat - coord.lat) < 1e-5
    );
    if (mk && mk.marker) {
      try {
        mk.marker.setAnimation("AMAP_ANIMATION_BOUNCE");
        setTimeout(() => {
          try { mk.marker.setAnimation("AMAP_ANIMATION_NONE"); } catch (_) {}
        }, 1800);
      } catch (_) {}
    }
  };

  // 点击右侧路线 → 地图 fit 到整条路线
  const focusRoute = (route) => {
    const { map, polylines } = mapDataRef.current || {};
    if (!map) return;
    const target = polylines.find((pl) =>
      pl.path.length >= 2 &&
      Math.abs(pl.path[0][0] - (route.markers?.[0]?.lng || route.path?.[0]?.[0])) < 1e-5 &&
      Math.abs(pl.path[0][1] - (route.markers?.[0]?.lat || route.path?.[0]?.[1])) < 1e-5
    );
    if (target) {
      try { map.setFitView([target.line], false, [80, 80, 80, 80]); } catch (_) {}
    }
  };

  return createPortal(
    <div
      className="map-lightbox"
      data-dev-id="map-lightbox"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="map-lightbox-fig" data-dev-id="ml-fig">
        <div className="map-lightbox-head" data-dev-id="ml-head">
          <span>地图总览 · {items.length} 处地点</span>
          <button className="map-lightbox-close" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="map-lightbox-body" data-dev-id="ml-body">
          <div className="map-detail-stage">
            <div className="map-detail-canvas" ref={canvasRef} />
            {!built && !builtErr && (
              <div className="mw-loading">
                <span className="mw-spinner" />
                <span>加载全景地图…</span>
              </div>
            )}
            {builtErr && <div className="map-detail-err">全景地图加载失败</div>}
          </div>
          <div className="map-detail-list">
            {items.map((it) => (
              <MapDetailRow key={it.id} item={it} onFocus={focusTo} onRouteFocus={focusRoute} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// 总览右侧：单张卡片的地点 / 路线明细（点击可聚焦到地图对应位置）
function MapDetailRow({ item, onFocus, onRouteFocus }) {
  const markers = item.markers || [];
  const route = item.route || null;
  return (
    <div className="map-detail-row">
      <div className="map-detail-row-head">{item.label || "位置标注"}</div>
      {markers.map((m, i) => (
        <div
          className="map-detail-sub map-detail-clickable"
          key={i}
          onClick={() => onFocus && onFocus({ lng: m.lng, lat: m.lat, label: m.label })}
          title="点击在地图上定位"
        >
          <span className="map-detail-k">{m.label || `点${i + 1}`}</span>
          <span className="map-detail-v">
            {m.lng.toFixed(6)}, {m.lat.toFixed(6)}
          </span>
        </div>
      ))}
      {route && (
        <div
          className="map-detail-sub map-detail-clickable"
          onClick={() => onRouteFocus && onRouteFocus(route)}
          title="点击查看整条路线"
        >
          <span className="map-detail-k">路线</span>
          <span className="map-detail-v">
            起 {(route.markers?.[0]?.label) || "起点"} → 终{" "}
            {(route.markers?.[1]?.label) || "终点"}
          </span>
        </div>
      )}
      {route && !route.path && (
        <div className="map-detail-note">路线为起终点直线示意（高德 MCP 未返回道路折线）</div>
      )}
    </div>
  );
}

function MapCard({ item, onRemove, onOpenDetail }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null); // AMap.Map 实例（用于卸载销毁）
  const resizeObserverRef = useRef(null); // 监听容器尺寸变化，触发地图重算
  const [status, setStatus] = useState("loading"); // loading | ready | error | text-only
  const [built, setBuilt] = useState(false); // 地图实例是否已就绪（控制 loading 显隐）

  // 懒加载 + 地图创建
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 无 Key B → 降级为文本模式
    if (!item.hasJsKey) {
      setStatus("text-only");
      return;
    }

    const hasData = (item.markers && item.markers.length > 0) || !!item.route;
    // 坐标/路线尚未到达（jarvis:map-start 先于 map-ready 50ms），挂起等待，
    // 否则空 markers 会触发 buildMap 的 NO_MARKERS。数据到了 effect 会重跑。
    if (!hasData) return;

    // 已初始化则跳过
    if (mapRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !mapRef.current) {
          initMap();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);

    // 若已在视口内，Observer 不一定立即触发，手动启动一次
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0 && !mapRef.current) {
      initMap();
    }

    return () => observer.disconnect();

    async function initMap() {
      if (mapRef.current) return;
      try {
        // buildMap 内部处理：loadAmap → 创建地图 → 标记点 + 路线 + fitView；
        // 点击标记 → 打开全景总览
        const map = await buildMap(
          el,
          item.markers || [],
          (item.route && item.route.path) || null,
          () => onOpenDetail && onOpenDetail()
        );
        if (!el.isConnected) return; // 已卸载
        mapRef.current = map;
        setBuilt(true);
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
  }, [item, status, onOpenDetail]);

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
      <div className={"mw-card mw-card--text" + (item.isNew ? " is-new" : "")}>
        <div className="mw-card-head">
          <span className="mw-card-label">{item.label || "位置标注"}</span>
          {onRemove && (
            <button className="mw-card-close" type="button" aria-label="移除" onClick={onRemove}>×</button>
          )}
        </div>
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

  const hasGeo = (item.markers && item.markers.length > 0) || !!item.route;

  return (
    <div className={"mw-card" + (item.isNew ? " is-new" : "")}>
      <div className="mw-card-head">
        <span className="mw-card-label">{item.label || "位置标注"}</span>
        <div className="mw-card-actions">
          {onRemove && (
            <button className="mw-card-close" type="button" aria-label="移除" onClick={onRemove}>×</button>
          )}
        </div>
      </div>
      {/* loading 必须与 .mw-map-canvas 平级（不能作为子节点），因为高德 new AMap.Map
          会清空容器，把 React 管理的 loading 节点删掉，导致后续 removeChild 崩溃。 */}
      {/* 整块画布可点击 → 全屏「地图总览」（聚合窗口内所有标记 + 路线），hasGeo 时给出 zoom-in 光标 */}
      <div
        className="mw-map-wrap"
        style={{ cursor: hasGeo ? "zoom-in" : "default" }}
        title={hasGeo ? "点击查看全部地图" : undefined}
        onClick={() => hasGeo && onOpenDetail && onOpenDetail()}
      >
        <div className="mw-map-canvas" ref={containerRef} />
        {/* 数据到达前 / 地图构建中持续显示 loading；构建完成（built）后隐藏 */}
        {!built && status !== "error" && status !== "text-only" && (
          <div className="mw-loading">
            <span className="mw-spinner" />
            <span>加载地图…</span>
          </div>
        )}
        {/* 构建完成后给出「点击查看全部」浮标（不拦截点击，pointer-events:none） */}
        {hasGeo && built && <div className="mw-map-hint">点击查看全部地图</div>}
        {/* 点击捕获层：高德 canvas/marker 会拦截事件，用透明层统一接管，确保点击打开全屏总览 */}
        {hasGeo && built && (
          <div
            className="mw-map-clickshield"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail && onOpenDetail();
            }}
          />
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
  const [detailOpen, setDetailOpen] = useState(false); // 全屏地图总览

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const b = bodyRef.current;
      if (b) b.scrollTop = b.scrollHeight;
    });
  }

  const onClearAll = () => setItems([]);
  const onRemoveCard = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

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
        return [...prev, { id: detail.id, status: "pending", isNew: true, createdAt: Date.now(), ...patch }];
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

  // 新增卡片时贴底，并 2.2s 后去掉 "is-new" 高亮
  useEffect(() => {
    scrollToBottom();
    const t = setTimeout(() => {
      setItems((prev) => prev.map((it) => (it.isNew ? { ...it, isNew: false } : it)));
    }, 2200);
    return () => clearTimeout(t);
  }, [items]);

  // 标题栏拖动（与 ImageWindow / McpPanel 同款）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".mw-close, .mw-clear, .mw-overview")) return;
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
  const hasGeo = items.some((i) => (i.markers && i.markers.length) || i.route);

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
        {items.length > 0 && (
          <button
            className="mw-overview"
            type="button"
            aria-label="全部地图总览"
            onClick={() => setDetailOpen(true)}
            title="全屏查看全部地图与路线"
          >
            ⊞
          </button>
        )}
        {items.length > 0 && (
          <button className="mw-clear" type="button" aria-label="清空全部" onClick={onClearAll} title="清空全部">
            ⌫
          </button>
        )}
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
          <MapCard key={it.id} item={it} onRemove={() => onRemoveCard(it.id)} onOpenDetail={() => setDetailOpen(true)} />
        ))}
      </div>

      <div className="mw-resize" onPointerDown={onResizePointerDown} title="拖动调整高度" />

      {/* 全屏地图总览：聚合窗口内所有标记 + 路线。Portal 到 body，z-index:9999 盖住地图窗口 */}
      {detailOpen && (
        <MapDetailLightbox items={items} onClose={() => setDetailOpen(false)} />
      )}
    </div>,
    document.body
  );
}
