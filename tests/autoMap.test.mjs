/**
 * 对话位置自动地图标注 · 解析器单测
 * 运行：node tests/autoMap.test.mjs （需 MCP Relay 在线，会真实调用 maps_geo / maps_direction_*）
 */
import { extractLocations, hasLocationIntent } from "../src/lib/locationExtractor.js";
import { parseGeoMarker, parseRoute, parseTextSearch, parseSearchDetail } from "../src/lib/mapParse.js";
import { sanitizeImageRefs, sanitizeField } from "../src/lib/traceSanitize.js";

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

console.log("[1] locationExtractor · 意图门槛 + 收紧后缀");
ok("纯闲聊 → 不触发", extractLocations("你好").length === 0);
ok("纯闲聊 → 不触发2", extractLocations("今天心情不错").length === 0);
ok("纯闲聊 → 不触发3", extractLocations("我刚看完一本小说").length === 0);
ok("个人提及「我家在北京市朝阳区」 → 不触发", extractLocations("我家在北京市朝阳区，工作在中关村").length === 0);
ok("日常提及「我去医院看医生」 → 不触发", extractLocations("我明天去医院看医生").length === 0);
ok("日常提及「我大学在北大」 → 不触发（"大学"已从 LANDMARK 移除）",
   extractLocations("我大学在北京").length === 0);
ok("日常提及「去公园散步」 → 不触发（"公园"已从 LANDMARK 移除）",
   extractLocations("今天天气好，去公园散步").length === 0);
ok("日常提及「我家小区很安静」 → 不触发（"小区"已从 LANDMARK 移除）",
   extractLocations("我家小区很安静").length === 0);
ok("去行政词裸出现「北京 上海 广州」 → 不触发（无意图）",
   extractLocations("北京 上海 广州 深圳 杭州".repeat(3)).length === 0);
ok("含 POI + 路线意图 → 触发",
   extractLocations("明天去上海外滩看夜景").some((x) => x.query.includes("外滩")));
ok("含天气意图 + 行政词 → 触发（杭州在 KNOWN_CITY）",
   extractLocations("杭州明天天气怎么样").some((x) => x.query.includes("杭州")));
ok("含路径意图 → 触发",
   extractLocations("从北京南站到首都机场怎么坐车最快").length >= 1);
ok("含附近意图 → 触发",
   extractLocations("上海外滩附近有什么好吃的").some((x) => x.query.includes("外滩")));
ok("@地图 命令 → 触发",
   extractLocations("@地图 上海外滩").some((x) => x.query.includes("外滩")));
ok("AI 终态里有「故宫介绍」 → 触发",
   extractLocations("故宫是明清两代的皇家宫殿，介绍一下").some((x) => x.query.includes("故宫")));
ok("KNOW_POI 在纯闲聊里直接出现 → 仍视为有意图",
   extractLocations("外滩").length === 1);
ok("句式「去...接人」 → 仍抽取（北京南站是 KNOWN_POI）",
   extractLocations("我想去北京南站接人").some((x) => x.query.includes("北京南站")));
ok("个人叙述前缀无查询动词 → 不触发",
   extractLocations("我家在北京市朝阳区，工作在中关村").length === 0);
ok("个人叙述前缀无查询动词 → 不触发2",
   extractLocations("我家在北京，明天去沈阳出差").length === 0);
ok("日常叙述涉及医院 → 不触发（医院已从 LANDMARK 移除）",
   extractLocations("我明天去医院看医生").length === 0);
ok("日常叙述涉及大学 → 不触发",
   extractLocations("我大学在北大").length === 0);
ok("日常叙述涉及小区/公园 → 不触发",
   extractLocations("我家小区很安静，今天去公园散步").length === 0);
ok("纯行政词裸出现 → 不触发",
   extractLocations("北京 上海 广州").length === 0);
ok("天气意图 + 城市名 → 触发（北京天气 → 抽北京）",
   extractLocations("北京今天天气怎么样").some((x) => x.query.includes("北京")));
ok("故宫天气 → 触发",
   extractLocations("故宫明天天气怎么样").some((x) => x.query.includes("故宫")));
ok("最多 3 个候选", extractLocations("明天去上海外滩看夜景，然后去陆家嘴吃饭，再到东方明珠").length <= 3);
ok("hasLocationIntent 识别关键词", hasLocationIntent("上海外滩附近") === true);
ok("hasLocationIntent 拒绝纯闲聊", hasLocationIntent("你好") === false);
ok("hasLocationIntent 个人叙述+POI → 拒绝",
   hasLocationIntent("我家在北京市朝阳区，工作在中关村") === false);
ok("hasLocationIntent 个人叙述+查询动词 → 接受",
   hasLocationIntent("我想去北京南站接人") === true);

console.log("[1b] locationExtractor · 上下文合并（CITY+POI，避免单 POI 歧义）");
ok("「明天去上海外滩」 → 合并为 ['上海外滩']，不出现「上海+外滩」两条",
   (() => {
     const r = extractLocations("明天去上海外滩看夜景");
     return r.length === 1 && r[0].query === "上海外滩";
   })(),
   (() => JSON.stringify(extractLocations("明天去上海外滩看夜景").map((x) => x.query)))());
ok("「上海外滩」→ 单条 '上海外滩'",
   (() => {
     const r = extractLocations("上海外滩附近的美食");
     return r.length === 1 && r[0].query === "上海外滩";
   })());
ok("「明天去上海陆家嘴」 → 单条 '上海陆家嘴'",
   (() => {
     const r = extractLocations("明天去上海陆家嘴吃饭");
     return r.length >= 1 && r[0].query === "上海陆家嘴";
   })());
ok("多个上海 POI 都合并到 '上海'（解决「外滩重名 → 跳到广州」的根因）",
   (() => {
     const r = extractLocations("明天去上海外滩，然后去陆家嘴吃饭，再到东方明珠");
     const qs = r.map((x) => x.query);
     return qs.includes("上海外滩") && qs.every((q) => /上海/.test(q));
   })());
ok("已含 CITY 的 POI 不重复合并（北京南站 → 不会出现 '北京北京南站'）",
   (() => {
     const r = extractLocations("从北京南站到首都机场怎么坐车最快");
     return r.every((c) => !/^北京北京/.test(c.query));
   })(),
   (() => JSON.stringify(extractLocations("从北京南站到首都机场怎么坐车最快").map((x) => x.query)))());
ok("「北京天气」 → 单条 '北京'",
   (() => {
     const r = extractLocations("北京天气");
     return r.length === 1 && r[0].query === "北京";
   })());
ok("「杭州明天天气」 → 单条 '杭州'",
   (() => {
     const r = extractLocations("杭州明天天气怎么样");
     return r.length === 1 && r[0].query === "杭州";
   })());
ok("纯行政词裸出现 + 无意图 → 不合并也不抽",
   (() => {
     const r = extractLocations("北京 上海 广州 深圳 杭州".repeat(3));
     return r.length === 0;
   })());
ok("合并后 limit 仍生效（≤3 条）",
   extractLocations("明天去上海外滩，然后去陆家嘴吃饭，再到东方明珠，再到南京路步行街").length <= 3);

console.log("[1b] POI 默认城市兜底 + ctx 覆盖");
ok("「东方明珠」单独 → 自动加默认城市前缀 '上海东方明珠'",
   extractLocations("东方明珠")[0].query === "上海东方明珠",
   JSON.stringify(extractLocations("东方明珠").map((x) => x.query)));
ok("「搜索外滩」 → '上海外滩'",
   extractLocations("搜索外滩")[0].query === "上海外滩");
ok("「故宫介绍一下」 → '北京故宫'",
   extractLocations("故宫介绍一下")[0].query === "北京故宫");
ok("「明天去天安门看升旗」 → '北京天安门'",
   extractLocations("明天去天安门看升旗")[0].query === "北京天安门");
ok("ctx 中的 CITY 覆盖默认城市（ctx='广州' + text='东方明珠' → '广州东方明珠'）",
   extractLocations("东方明珠", { ctx: ["广州"] })[0].query === "广州东方明珠");
ok("ctx 中的 CITY 覆盖默认城市（ctx='西安' + text='故宫' → '西安故宫'）",
   extractLocations("故宫", { ctx: ["西安"] })[0].query === "西安故宫");
ok("ctx=多城市时取最近（ctx=['北京','上海','广州']+ text='东方明珠' → '广州东方明珠'）",
   extractLocations("东方明珠", { ctx: ["北京", "上海", "广州"] })[0].query === "广州东方明珠");
ok("负面用例在 ctx 下仍不触发（ctx=['上海','外滩'] + text='你好' → []）",
   extractLocations("你好", { ctx: ["上海", "外滩"] }).length === 0);
ok("已含 CITY 的 POI 不被重复合并（'上海虹桥站' → 不是 '上海上海虹桥站'）",
   extractLocations("上海虹桥站怎么走")[0].query === "上海虹桥站");
ok("已含 CITY 的 POI 不被重复合并（'北京南站附近' → 不是 '北京北京南站'）",
   extractLocations("北京南站附近")[0].query === "北京南站");

console.log("[2a] parseTextSearch（真实 maps_text_search 返回）");
const tsContent = await callMcp("maps_text_search", { keywords: "上海东方明珠", city: "上海" });
const top = parseTextSearch(tsContent);
ok("text_search 返回 ≥1 条 poi", top && top.id, JSON.stringify(top));
ok("top.poi 是「东方明珠广播电视塔」", top && /东方明珠/.test(top.name), top && top.name);
ok("top.poi 含 id（B00150F6D6）", top && /^B0[A-Z0-9]+$/.test(top.id), top && top.id);

console.log("[2c] parseSearchDetail（真实 maps_search_detail 返回）");
const detContent = await callMcp("maps_search_detail", { id: top.id });
const det = parseSearchDetail(detContent);
ok("detail 拿到精确 location", det && typeof det.lng === "number" && typeof det.lat === "number", det && JSON.stringify(det));
ok("东方明珠塔精确坐标在上海陆家嘴 (121.49~121.51, 31.23~31.25)",
   det && det.lng > 121.49 && det.lng < 121.51 && det.lat > 31.23 && det.lat < 31.25,
   det && (det.lng + "," + det.lat));
ok("detail.business_area 含「陆家嘴」",
   det && /陆家嘴/.test(det.business_area),
   det && det.business_area);

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

console.log("[5] traceSanitize · 抹掉图像引用 / 本地路径");
ok("@image#1:\"...\" → 占位符",
   sanitizeImageRefs('xxx @image#1:"C:\\a\\b.png" yyy').includes("[附图]") &&
   !/C:\\a\\b\\.png/.test(sanitizeImageRefs('xxx @image#1:"C:\\a\\b.png" yyy')));
ok("<image_local_path>...</image_local_path> → 占位符",
   sanitizeImageRefs("正文 <image_local_path>C:\\qq截图\\x.png</image_local_path> 继续").includes("[附图]") &&
   !/image_local_path/.test(sanitizeImageRefs("正文 <image_local_path>C:\\qq截图\\x.png</image_local_path> 继续")));
ok("json 字段 image_local_path 路径值被替换（字段名保留）",
   (() => {
     const out = sanitizeImageRefs('{"image_local_path":"C:\\qq截图\\x.png","width":800}');
     return out.includes("[附图]") && !/C:\\qq截图\\x\.png/.test(out) && /"image_local_path"/.test(out);
   })());
ok("Windows 路径结尾带 .png → 占位符",
   sanitizeImageRefs("参考 C:\\Users\\me\\桌面\\局部截取.png 之后").includes("[附图]") &&
   !/局部截取\.png/.test(sanitizeImageRefs("参考 C:\\Users\\me\\桌面\\局部截取.png 之后")));
ok("普通文本不受影响",
   sanitizeImageRefs("明天去西湖看夜景") === "明天去西湖看夜景");
ok("sanitizeField 截断过长结果",
   sanitizeField("a".repeat(200)).endsWith("…"));
ok("sanitizeField 处理 null", sanitizeField(null) === "—");

console.log("[6] sanitizeImageRefs · 渲染用法（与 useChatController 路径一致）");
ok("AI 回复含 @image#N → 渲染前脱敏",
   (() => {
     const out = sanitizeImageRefs('好的，这是截图 @image#1:"C:\\a\\x.png" 请看');
     return /\[附图\]/.test(out) && !/@image#/.test(out);
   })());
ok("AI 回复含 Windows 路径 → 渲染前脱敏",
   (() => {
     const out = sanitizeImageRefs("图像保存在 C:\\Users\\me\\Desktop\\图.png");
     return !/C:\\Users/.test(out) && /\[附图\]/.test(out);
   })());
ok("幂等：sanitize 后再 sanitize 仍然干净（流式每 chunk 都过的前提）",
   (() => {
     const reply = "正常的回复文本";
     return sanitizeImageRefs(reply) === sanitizeImageRefs(sanitizeImageRefs(reply));
   })());

console.log("\n结果：PASS=" + pass + "  FAIL=" + fail);
process.exit(fail ? 1 : 0);
