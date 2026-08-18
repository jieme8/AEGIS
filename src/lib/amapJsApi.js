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

/** 确保 AMap 插件已加载（2.0 中 Marker/Polyline 等需要显式加载）。 */
function loadAmapPlugins(AMap, names) {
  return new Promise((resolve, reject) => {
    AMap.plugin(names, (err) => {
      if (err && err.info) reject(new Error("AMap plugin load failed: " + err.info));
      else resolve();
    });
  });
}

/**
 * 在容器内创建地图并标注。
 * @param {HTMLElement} container
 * @param {Array<{lng:number,lat:number,label?:string}>} markers
 * @param {Array<[number,number]>|null} route 路线坐标数组（GCJ-02）
 */
export function buildMap(container, markers = [], route = null, onMarkerClick = null) {
  return loadAmap().then(async (AMap) => {
    if (!markers.length) throw new Error("NO_MARKERS");
    await loadAmapPlugins(AMap, ["AMap.Marker", "AMap.Polyline"]);

    const center = [markers[0].lng, markers[0].lat];
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
        // 在标记上方显示地点名称，提升可读性
        label: mk.label
          ? { content: "<span class='amap-marker-label'>" + mk.label + "</span>", direction: "top" }
          : undefined,
      });
      // 点击标记 → 打开详情面板（点击回调由调用方传入，避免高德原生 InfoWindow 被暗色滤镜反转）
      if (onMarkerClick) m.on("click", () => onMarkerClick(mk));
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
    if (overlays.length) {
      try {
        map.setFitView(overlays, false, [40, 40, 40, 40]);
        // 单点场景 setFitView 可能缩到楼级，限制最大 zoom 让街道名可读
        const z = map.getZoom();
        if (z > 17) map.setZoom(17);
      } catch (e) { /* 忽略 */ }
    }
    return map;
  });
}

/**
 * 聚合地图（全屏总览）：在单个容器内渲染「多个卡片」的全部标记 + 全部路线。
 * 用于点击任意卡片 → 全屏显示窗口内所有地点与路线。
 * @param {HTMLElement} container
 * @param {Array<{label?:string, markers?:Array<{lng,lat,label?}>, route?:{path?:Array, markers?:Array<{lng,lat,label?}>}}>} items
 * @param {Function|null} onMarkerClick
 */
export function buildMultiMap(container, items = [], onMarkerClick = null) {
  return loadAmap().then(async (AMap) => {
    // 去重收集所有标记点：卡片 markers + 路线起终点（按坐标去重，避免重叠）
    const seen = new Set();
    const points = [];
    const routes = [];
    (items || []).forEach((it) => {
      (it.markers || []).forEach((m) => {
        const key = m.lng.toFixed(5) + "," + m.lat.toFixed(5);
        if (!seen.has(key)) { seen.add(key); points.push(m); }
      });
      if (it.route) routes.push(it.route);
    });
    routes.forEach((rt) => {
      (rt.markers || []).forEach((m) => {
        const key = m.lng.toFixed(5) + "," + m.lat.toFixed(5);
        if (!seen.has(key)) { seen.add(key); points.push(m); }
      });
    });

    if (!points.length && !routes.length) throw new Error("NO_MARKERS");

    await loadAmapPlugins(AMap, ["AMap.Marker", "AMap.Polyline"]);
    const center = points.length ? [points[0].lng, points[0].lat] : [0, 0];
    const map = new AMap.Map(container, { zoom: 11, center, viewMode: "2D" });

    const overlays = [];
    const markerEntries = []; // {lng, lat, label, marker}
    const lineEntries = [];   // {path, line}

    // 全部标记点（含路线起终点）
    points.forEach((mk) => {
      const m = new AMap.Marker({
        position: [mk.lng, mk.lat],
        title: mk.label || "",
        anchor: "bottom-center",
        label: mk.label
          ? { content: "<span class='amap-marker-label'>" + mk.label + "</span>", direction: "top" }
          : undefined,
      });
      if (onMarkerClick) m.on("click", () => onMarkerClick(mk));
      map.add(m);
      overlays.push(m);
      markerEntries.push({ ...mk, marker: m });
    });

    // 全部路线：有真实道路折线用折线，否则用起终点直线示意
    routes.forEach((rt) => {
      let path = null;
      if (rt.path && Array.isArray(rt.path) && rt.path.length >= 2) {
        path = rt.path.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.lng, p.lat]));
      } else if (rt.markers && rt.markers.length >= 2) {
        path = [
          [rt.markers[0].lng, rt.markers[0].lat],
          [rt.markers[rt.markers.length - 1].lng, rt.markers[rt.markers.length - 1].lat],
        ];
      }
      if (path) {
        const line = new AMap.Polyline({
          path,
          strokeColor: "#ff1493",
          strokeWeight: 5,
          strokeOpacity: 0.9,
          showDir: true,
          lineJoin: "round",
          geodesic: true,
          zIndex: 60,
        });
        map.add(line);
        overlays.push(line);
        lineEntries.push({ path, line });
      }
    });

    if (overlays.length) {
      try {
        map.setFitView(overlays, false, [60, 60, 60, 60]);
        const z = map.getZoom();
        if (z > 17) map.setZoom(17);
      } catch (e) { /* 忽略 */ }
    }
    return { map, markers: markerEntries, polylines: lineEntries };
  });
}
