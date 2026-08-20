/**
 * 内联地图卡片（对话自动地图标注 · 渲染组件）
 *
 * 命令式 DOM 构建（与 chat-panel 的消息渲染一致），挂在某条消息 wrap 之后。
 * - 有 Key B：懒加载高德 JS API，渲染小地图（多 Marker + fitBounds / 路线 Polyline）。
 * - 无 Key B：降级为「位置文本卡片」（地址 + GCJ-02 坐标），不崩。
 *
 * 注意：本文件按命令式 DOM 实现（非 React 每消息渲染），故虽为 .jsx 但仅导出函数。
 */

import { loadAmap, buildMap, hasAmapKey } from "../../lib/amapJsApi.js";

function buildTextFallback(markers) {
  const ul = document.createElement("ul");
  ul.className = "map-card-list";
  markers.forEach((mk) => {
    const li = document.createElement("li");
    li.textContent = (mk.label || "位置") + " · " + mk.lng.toFixed(6) + ", " + mk.lat.toFixed(6);
    ul.appendChild(li);
  });
  return ul;
}

/**
 * 构建一张内联地图卡片 DOM 元素。
 * @param {Array<{lng:number,lat:number,label?:string}>} markers
 * @param {Array<[number,number]>|null} route
 * @param {"user"|"ai"} [role="ai"]
 * @returns {HTMLElement}
 */
export function createMapCardElement(markers = [], route = null, role = "ai") {
  const card = document.createElement("div");
  card.className = "map-card " + (role === "user" ? "map-card-user" : "map-card-ai");

  const head = document.createElement("div");
  head.className = "map-card-head";
  const title = document.createElement("span");
  title.className = "map-card-title";
  title.textContent = route ? "路线标注" : "位置标注";
  const closeBtn = document.createElement("button");
  closeBtn.className = "map-card-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = "收起地图";
  closeBtn.addEventListener("click", () => card.remove());
  head.appendChild(title);
  head.appendChild(closeBtn);
  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "map-card-body";
  card.appendChild(body);

  // 降级：无 Key B → 文本卡片
  if (!hasAmapKey()) {
    card.classList.add("map-card--text");
    body.appendChild(buildTextFallback(markers));
    const hint = document.createElement("div");
    hint.className = "map-card-hint";
    hint.textContent = "（未配置高德 JS API Key，仅显示坐标；在 .env 设置 VITE_AMAP_JS_KEY 即可加载地图瓦片）";
    body.appendChild(hint);
    return card;
  }

  // 有 Key：地图占位 + IntersectionObserver 懒加载
  const canvas = document.createElement("div");
  canvas.className = "map-card-canvas";
  body.appendChild(canvas);

  let inited = false;
  const init = () => {
    if (inited) return;
    inited = true;
    buildMap(canvas, markers, route).catch((err) => {
      console.warn("[map-card] 地图初始化失败，降级为文本卡片：", err && err.message);
      body.innerHTML = "";
      card.classList.add("map-card--text");
      body.appendChild(buildTextFallback(markers));
      const hint = document.createElement("div");
      hint.className = "map-card-hint";
      hint.textContent = "（地图加载失败，已降级为坐标文本；请检查 Key / Referer 白名单）";
      body.appendChild(hint);
    });
  };

  if (typeof window !== "undefined" && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            init();
            io.disconnect();
          }
        });
      },
      { root: null, threshold: 0.15 }
    );
    io.observe(card);
  } else {
    init();
  }

  return card;
}
