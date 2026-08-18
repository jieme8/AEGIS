/**
 * 对话位置自动地图标注 · 解析器单测
 * 运行：node tests/autoMap.test.mjs （需 MCP Relay 在线，会真实调用 maps_geo / maps_direction_*）
 */
import { extractLocations } from "../src/lib/locationExtractor.js";
import { parseGeoMarker, parseRoute } from "../src/lib/mapParse.js";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

async function callMcp(name, args) {
  const r = await fetch("http://localhost:8787/api/mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  const data = await r.json();
  return data.content; // 已是字符串
}

console.log("[1] locationExtractor");
ok("含省市区 → 命中", (() => {
  const r = extractLocations("我在杭州市西湖区，明天去上海外滩看夜景");
  return r.some((x) => x.query.includes("杭州")) && r.some((x) => x.query.includes("外滩"));
})(), JSON.stringify(extractLocations("我在杭州市西湖区，明天去上海外滩看夜景")));
ok("纯闲聊 → 不触发", extractLocations("你好").length === 0);
ok("纯闲聊 → 不触发2", extractLocations("今天心情不错").length === 0);
ok("句式「到...」抽取", extractLocations("我想去北京南站接人").some((x) => x.query.includes("北京南站")));
ok("最多 3 个候选", extractLocations("北京 上海 广州 深圳 杭州".repeat(3)).length <= 3);
ok("去重", (() => {
  const r = extractLocations("西湖区 西湖区 西湖区");
  return r.length === 1;
})());

console.log("[2] parseGeoMarker（真实 maps_geo 返回）");
const geoContent = await callMcp("maps_geo", { address: "杭州西湖" });
const geo = parseGeoMarker(geoContent, "杭州西湖");
ok("解析出经纬度", geo && typeof geo.lng === "number" && typeof geo.lat === "number",
  JSON.stringify(geo));
ok("GCJ-02 范围合理(杭州附近)", geo && geo.lng > 118 && geo.lng < 122 && geo.lat > 28 && geo.lat < 32,
  geo && (geo.lng + "," + geo.lat));
ok("label 含行政区划", geo && /杭州|西湖/.test(geo.label), geo && geo.label);

console.log("[3] parseRoute（真实 maps_direction_transit_integrated 返回）");
const routeContent = await callMcp("maps_direction_transit_integrated", {
  origin: "116.378643,39.865324", destination: "116.597076,40.079352", city: "北京", cityd: "北京",
});
const rt = parseRoute(routeContent);
ok("解析出起/终点标记", rt && rt.markers && rt.markers.length === 2, rt && JSON.stringify(rt && rt.markers));
ok("起点为北京南站附近(经度116.37~116.4)",
  rt && rt.markers[0].lng > 116.37 && rt.markers[0].lng < 116.4,
  rt && JSON.stringify(rt && rt.markers && rt.markers[0]));
ok("终点为首都机场附近(经度~116.59)",
  rt && rt.markers[1].lng > 116.55 && rt.markers[1].lng < 116.62,
  rt && JSON.stringify(rt && rt.markers && rt.markers[1]));
ok("当前高德 MCP 方向工具无 polyline → path 为 null（仅标起终点）", rt && rt.path === null,
  rt && String(rt && rt.path));

console.log("[4] 降级：脏输入不崩");
ok("parseGeoMarker(非JSON) → null", parseGeoMarker("not json at all", "x") === null);
ok("parseRoute(非JSON) → null", parseRoute("{}") === null);
ok("parseRoute(无polyline) → null", parseRoute('{"foo":1}') === null);

console.log("\n结果：PASS=" + pass + "  FAIL=" + fail);
process.exit(fail ? 1 : 0);
