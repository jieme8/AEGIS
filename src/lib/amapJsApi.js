/**
 * 高德 JS API 2.0 动态加载 + 地图/标记/路线封装（对话自动地图标注 · 渲染层）
 *
 * - Key B（Web 端 JS API）为公开客户端密钥，从 .env 经 Vite 注入：
 *   import.meta.env.VITE_AMAP_JS_KEY。缺失时 hasAmapKey()=false，调用方降级为
 *   「位置文本卡片」，绝不硬编码 key、绝不崩溃。
 * - 坐标系 GCJ-02：MCP 返回与高德 JS API 同源，直绘无偏移、无需转换。
 * - 脚本仅加载一次（loaderPromise 单例）。
 */

// Key B：仅前端 JS API 使用，与 .env 中的 AMAP_MAPS_API_KEY（Key A，Web 服务，服务端）不同。
const JS_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_AMAP_JS_KEY) || "";
const SCRIPT_ID = "amap-jsapi-script";
let loaderPromise = null;

export function hasAmapKey() {
  return typeof JS_KEY === "string" && JS_KEY.length > 0;
}

/** 动态加载高德 JS API 2.0；无 Key 时 reject（交由调用方降级）。 */
export function loadAmap() {
  if (!hasAmapKey()) return Promise.reject(new Error("AMAP_JS_KEY_MISSING"));
  if (typeof window !== "undefined" && window.AMap) return Promise.resolve(window.AMap);
  if (loaderPromise) return loaderPromise;
  // 高德 JS API 2.0 强制安全密钥：必须在加载脚本前注入 window._AMapSecurityConfig
  const SECURITY =
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_AMAP_JS_SECURITY) || "";
  if (typeof window !== "undefined") {
    window._AMapSecurityConfig = { securityJsCode: SECURITY };
  }
  loaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = "https://webapi.amap.com/maps?v=2.0&key=" + encodeURIComponent(JS_KEY);
    s.async = true;
    s.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("AMap 全局对象未就绪"));
    };
    s.onerror = () => reject(new Error("AMap 脚本加载失败（检查 Key / 网络 / Referer 白名单）"));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

/**
 * 在容器内创建地图并标注。
 * @param {HTMLElement} container
 * @param {Array<{lng:number,lat:number,label?:string}>} markers
 * @param {Array<[number,number]>|null} route 路线坐标数组（GCJ-02）
 */
export function buildMap(container, markers = [], route = null) {
  return loadAmap().then((AMap) => {
    const center = markers.length ? [markers[0].lng, markers[0].lat] : [116.397428, 39.90923];
    const map = new AMap.Map(container, { zoom: 11, center, viewMode: "2D" });
    // 注意：高德 JS API 2.0 的 setMapStyle("amap://styles/dark") 在部分 key/版本下
    // 会异步抛出 "reading 'pn'"（try/catch 捕获不到），进而导致整页 React 崩溃。
    // 暗色观感改由 CSS 滤镜在 .mw-map-canvas 容器上实现（见 cyber.css），此处不调用。

    const overlays = [];
    markers.forEach((mk) => {
      const m = new AMap.Marker({
        position: [mk.lng, mk.lat],
        title: mk.label || "",
        anchor: "bottom-center",
      });
      map.add(m);
      overlays.push(m);
    });
    if (route && Array.isArray(route) && route.length >= 2) {
      const line = new AMap.Polyline({
        path: route,
        strokeColor: "#39d0d8",
        strokeWeight: 4,
        showDir: true,
        lineJoin: "round",
        zIndex: 60,
      });
      map.add(line);
      overlays.push(line);
    }
    if (markers.length > 1) {
      try { map.setFitView(overlays, false, [40, 40, 40, 40]); } catch (e) { /* 忽略 */ }
    }
    return map;
  });
}
