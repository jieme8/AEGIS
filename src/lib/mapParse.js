/**
 * 高德 MCP 工具返回解析（对话自动地图标注）
 *
 * 把 maps_geo / maps_text_search / maps_search_detail / maps_direction_* 的工具返回
 * 文本解析为地图可用的 {lng,lat,label} 标记 / {path, markers} 路线。纯函数，便于单测。
 *
 * 坐标体系 GCJ-02，与高德 JS API 同源，直绘无偏移。
 */

/**
 * 解析 maps_geo 返回为单个标记 {lng,lat,label}
 * 真实结构：{ "return": [ { location:"120.13,30.25", province, city, district, ... } ] }
 *
 * ⚠️ 注意：maps_geo 对中国知名 POI 的命中率很飘：
 *   - maps_geo("上海东方明珠") → level:"省" 的上海市中心 (121.47, 31.23)，完全不精确
 *   - maps_geo("东方明珠")      → 邵阳住宅区 (111.47, 27.23)
 * 因此建议先走 parseTextSearch + parseSearchDetail 再回退 maps_geo（见 maybeShowMap）。
 */
/**
 * 城市名 → 中心点（GCJ-02）。
 * 来源：高德公开城区大致中心，用于"marker 是否落在合理城市范围内"的距离门限判断。
 * 注意：广州/重庆/武汉/长沙等，因当前 KNOWN_CITY 不含，暂不列入（不挡）。
 */
export const CITY_CENTERS = {
  上海: { lng: 121.4737, lat: 31.2304 },
  北京: { lng: 116.4074, lat: 39.9042 },
  天津: { lng: 117.2008, lat: 39.0842 },
  广州: { lng: 113.2644, lat: 23.1291 },
  深圳: { lng: 114.0579, lat: 22.5431 },
  杭州: { lng: 120.1551, lat: 30.2741 },
  南京: { lng: 118.7969, lat: 32.0603 },
  苏州: { lng: 120.5853, lat: 31.2989 },
  成都: { lng: 104.0668, lat: 30.5728 },
  武汉: { lng: 114.3055, lat: 30.5928 },
  西安: { lng: 108.9402, lat: 34.3416 },
  厦门: { lng: 118.0894, lat: 24.4798 },
  青岛: { lng: 120.3826, lat: 36.0671 },
  昆明: { lng: 102.8329, lat: 24.8801 },
  大理: { lng: 100.2257, lat: 25.5916 },
  丽江: { lng: 100.2336, lat: 26.8721 },
  三亚: { lng: 109.5119, lat: 18.2528 },
  海口: { lng: 110.3312, lat: 20.0311 },
  拉萨: { lng: 91.1322, lat: 29.6604 },
  兰州: { lng: 103.8343, lat: 36.0611 },
  西宁: { lng: 101.7782, lat: 36.6171 },
  乌鲁木齐: { lng: 87.6168, lat: 43.8256 },
  贵阳: { lng: 106.7135, lat: 26.5783 },
  南宁: { lng: 108.3669, lat: 22.8170 },
  石家庄: { lng: 114.5149, lat: 38.0428 },
  太原: { lng: 112.5489, lat: 37.8706 },
  呼和浩特: { lng: 111.7519, lat: 40.8414 },
  银川: { lng: 106.2309, lat: 38.4872 },
  南昌: { lng: 115.8921, lat: 28.6765 },
  沈阳: { lng: 123.4315, lat: 41.8057 },
  大连: { lng: 121.6147, lat: 38.9140 },
  哈尔滨: { lng: 126.5350, lat: 45.8023 },
  长春: { lng: 125.3245, lat: 43.8868 },
  无锡: { lng: 120.3119, lat: 31.4912 },
  佛山: { lng: 113.1216, lat: 23.0218 },
  东莞: { lng: 113.7518, lat: 23.0207 },
  桂林: { lng: 110.2900, lat: 25.2740 },
};

const EARTH_KM = 6371.0088;
function _haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 距离门限（km）：marker 距离期望城市中心 > MAX_KM 视为异常（跨省同名误匹配）。
 * 上海/北京/广州这类大市用 80km；其它城市可适当放宽。
 */
const MAX_KM_BIG = 80;        // 北京/上海/广州/深圳/天津/重庆/杭州/南京/成都/武汉/西安
const MAX_KM_NORMAL = 60;     // 中等城市

const BIG_CITY = new Set(["上海", "北京", "广州", "深圳", "天津", "重庆", "杭州", "南京", "成都", "武汉", "西安"]);

/**
 * 校验 marker 坐标是否"足够近"期望城市中心。
 * 用法：返回一个判断结果对象，不修改 marker（不破坏流水线）。
 *
 * @param {{lng:number, lat:number}} marker
 * @param {string|null} expectedCity 期望城市（caller 从 text/ctx/query 推断出来的 KNOWN_CITY 之一）
 * @returns {{ ok:boolean, distanceKm?:number, reason?:string }}
 */
export function validateAgainstCity(marker, expectedCity) {
  if (!marker || typeof marker.lng !== "number" || typeof marker.lat !== "number") {
    return { ok: false, reason: "marker 缺少经纬度" };
  }
  if (!expectedCity) return { ok: true }; // 无期望城市 → 不挡（保守放行）
  const center = CITY_CENTERS[expectedCity];
  if (!center) return { ok: true }; // 不在已知表中 → 不挡
  const d = _haversineKm({ lng: marker.lng, lat: marker.lat }, center);
  const limit = BIG_CITY.has(expectedCity) ? MAX_KM_BIG : MAX_KM_NORMAL;
  if (d > limit) {
    return { ok: false, distanceKm: d, reason: `与期望城市 ${expectedCity} 相距 ${d.toFixed(1)}km（>${limit}km 阈值）` };
  }
  return { ok: true, distanceKm: d };
}

/**
 * 从一段自由文本里猜"上下文城市"：返回第一个出现且 CITY_CENTERS 已知的 KNOWN_CITY。
 * 用于"ctx+text 里多数出现上海，但某个 query 不以'上海'开头"时，给 cityArg 兜底。
 * @param {string} text
 * @returns {string|null}
 */
export function guessContextCity(text) {
  if (!text || typeof text !== "string") return null;
  // 按"KNOWN_CITY 出现顺序"扫一遍，命中即返回（兼顾最早出现通常最重要）。
  // 注：与 KNOWN_CITY 列表解耦，这里直接引用 locationExtractor 的 KNOWN_CITY（避免重复定义）。
  // 为避免循环依赖，这里维护一个简短的子集（仅含 CITY_CENTERS 有条目的城市）。
  for (const city of Object.keys(CITY_CENTERS)) {
    if (text.includes(city)) return city;
  }
  return null;
}

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
 * 解析 maps_text_search 返回，提取第一条 POI
 * 真实结构：{ "suggestion": {...}, "pois": [ { id, name, address, typecode, ... } ] }
 *
 * 为什么需要这个：maps_geo 对知名 POI 返回 "省/市/住宅区" 级别的位置，完全不精确；
 * maps_text_search 会按相关度返回真正的 POI（第一项就是东方明珠广播电视塔 / 西湖 / 外滩）。
 * 拿到 id 后再调 maps_search_detail 即可获得精确坐标（如东方明珠塔 121.499718, 31.239703）。
 *
 * @returns {{id, name, address, city}|null}
 */
export function parseTextSearch(content) {
  if (!content || typeof content !== "string") return null;
  let obj = null;
  try { obj = JSON.parse(content); } catch (e) { return null; }
  const pois = obj && obj.pois;
  if (!Array.isArray(pois) || pois.length === 0) return null;
  const top = pois[0];
  if (!top || !top.id) return null;
  return {
    id: top.id,
    name: top.name || "",
    address: top.address || "",
    city: top.cityname || "",
  };
}

/**
 * 解析 maps_search_detail 返回，提取精确 location
 * 真实结构：{ id, name, location:"121.499718,31.239703", address, business_area, type, level, ... }
 * @returns {{lng, lat, name, address, business_area, type, label}|null}
 */
export function parseSearchDetail(content) {
  if (!content || typeof content !== "string") return null;
  let obj = null;
  try { obj = JSON.parse(content); } catch (e) { return null; }
  if (!obj || !obj.location) return null;
  const parts = String(obj.location).split(",").map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return {
    lng: parts[0],
    lat: parts[1],
    name: obj.name || "",
    address: obj.address || "",
    business_area: obj.business_area || "",
    type: obj.type || "",
    label: obj.name || obj.address || "位置",
  };
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