/**
 * 高德 MCP 工具返回解析（对话自动地图标注）
 *
 * 把 maps_geo / maps_direction_* 的工具返回文本解析为地图可用的
 * {lng,lat,label} 标记 / {path, markers} 路线。纯函数，便于单测。
 *
 * 坐标体系 GCJ-02，与高德 JS API 同源，直绘无偏移。
 */

/**
 * 解析 maps_geo 返回为单个标记 {lng,lat,label}
 * 真实结构：{ "return": [ { location:"120.13,30.25", province, city, district, ... } ] }
 */
export function parseGeoMarker(content, label) {
  if (!content || typeof content !== "string") return null;
  let obj = null;
  try {
    obj = JSON.parse(content);
  } catch (e) {
    const mm = /(\d{1,3}\.\d+)\s*,\s*(\d{1,3}\.\d+)/.exec(content);
    if (mm) {
      const lng = Number(mm[1]), lat = Number(mm[2]);
      if (!isNaN(lng) && !isNaN(lat)) return { lng, lat, label: label || "位置" };
    }
    return null;
  }
  const arr = obj && obj.return ? obj.return : Array.isArray(obj) ? obj : null;
  if (arr && arr[0]) {
    const item = arr[0];
    const loc = item.location || (item.geocodes && item.geocodes[0] && item.geocodes[0].location);
    if (loc) {
      const parts = String(loc).split(",").map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const lbl =
          label ||
          [item.province, item.city, item.district].filter(Boolean).join("") ||
          item.formatted_address ||
          "位置";
        return { lng: parts[0], lat: parts[1], label: lbl };
      }
    }
  }
  return null;
}

/**
 * 解析方向类工具（maps_direction_*）返回为 {path, markers}
 * 真实结构：route.transits[].segments[].{walking,bus,railway}.polyline（"lng,lat;..."）
 * 采用递归扫描所有 key==="polyline" 的字符串并拼接，鲁棒覆盖驾车/步行/公交/地铁。
 */
export function parseRoute(content) {
  if (!content || typeof content !== "string") return null;
  let obj = null;
  try { obj = JSON.parse(content); } catch (e) { return null; }
  const route = obj && obj.route;
  if (!route) return null;

  // 1) 优先：收集 polyline 串（部分工具/未来版本会返回；当前高德 MCP 方向工具未返回）
  const polys = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const k in o) {
      const v = o[k];
      if (k === "polyline" && typeof v === "string" && v.includes(";")) polys.push(v);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(obj);
  if (polys.length) {
    const coords = [];
    polys.forEach((p) =>
      p.split(";").forEach((pt) => {
        const c = pt.split(",").map(Number);
        if (c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])) coords.push([c[0], c[1]]);
      })
    );
    if (coords.length >= 2) {
      return {
        path: coords,
        markers: [
          { lng: coords[0][0], lat: coords[0][1], label: "起点" },
          { lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1], label: "终点" },
        ],
      };
    }
  }

  // 2) 退化：方向工具多只给 origin/destination 坐标（无 polyline）→ 仅标起终点
  const o = route.origin, d = route.destination;
  if (o && d) {
    const oc = String(o).split(",").map(Number);
    const dc = String(d).split(",").map(Number);
    if (oc.length === 2 && dc.length === 2 && !isNaN(oc[0]) && !isNaN(dc[0]) && !isNaN(oc[1]) && !isNaN(dc[1])) {
      return {
        path: null,
        markers: [
          { lng: oc[0], lat: oc[1], label: "起点" },
          { lng: dc[0], lat: dc[1], label: "终点" },
        ],
      };
    }
  }
  return null;
}
