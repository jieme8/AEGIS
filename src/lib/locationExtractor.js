/**
 * 位置实体抽取器（对话自动地图标注 · 来源①）
 *
 * 零额外请求、低延迟：用正则 + 地名词典从消息文本里抠出地址候选，
 * 再交给高德 MCP（maps_geo）做地理编码。后期可升级为 LLM 辅助标注。
 *
 * 输出：[{ text, query }]
 *  - text：原文命中的片段（用于地图标记 label）
 *  - query：送 maps_geo 的干净地址串
 */

// 行政/路名/地标后缀词（命中任一即视为位置候选）
const ADMIN_SUFFIX = ["省", "市", "区", "县", "镇", "乡", "村"];
const ROAD_SUFFIX = ["路", "街", "大道", "巷", "弄"];
const LANDMARK_SUFFIX = [
  "大厦", "大楼", "广场", "公园", "景区", "景点", "车站", "火车站", "高铁站",
  "机场", "地铁站", "大学", "学院", "医院", "商场", "购物中心", "酒店", "宾馆",
  "小区", "工业园", "科技园", "体育馆", "博物馆", "图书馆",
];

// 知名 POI 白名单（直接命中，减少误判；可继续扩充）
const KNOWN_POI = [
  "西湖", "外滩", "天安门", "故宫", "东方明珠", "北京南站", "首都机场",
  "上海虹桥站", "杭州东站", "深圳北站", "广州南站", "浦东机场", "白云机场",
  "中关村", "陆家嘴", "三里屯", "西单", "王府井", "颐和园", "长城", "兵马俑",
];

const PLACE_RE =
  /[一-龥]{1,12}(?:省|市|区|县|镇|乡|村)|[一-龥]{1,12}(?:路|街|大道|巷|弄)|[一-龥]{2,12}(?:大厦|大楼|广场|公园|景区|景点|车站|火车站|高铁站|机场|地铁站|大学|学院|医院|商场|购物中心|酒店|宾馆|小区|工业园|科技园|体育馆|博物馆|图书馆)/g;

// 句式：在/去/到/从 + 地点 + 方位/动作词
const SENT_RE = /(?:在|去|到|从|往)(.{2,10}?)(?:附近|旁边|边上|出发|到|怎么走|在哪里|在哪|坐车|乘车)/g;

const TRAILING_STOP =
  /(?:附近|旁边|边上|出发|怎么走|在哪里|在哪|坐车|乘车|玩|看看|旅游|旅行|的|吗|呢|吧|啊|呀|哦|嘛|咯)\s*$/;

function normalize(raw) {
  if (!raw) return "";
  let t = String(raw).trim();
  t = t.replace(/^(?:我|我们|你|你们|他|他们|她|她们|它|它们|咱|咱们)?(?:在|去|到|从|往|来|回|赴)\s*/, ""); // 去掉"我在/我们去"等前缀，保留纯地名
  t = t.replace(TRAILING_STOP, ""); // 去尾随方位/语气词
  if (t.length < 2) return "";
  const hasPlace = new RegExp(
    "(?:省|市|区|县|镇|乡|村|路|街|大道|巷|弄|" +
      LANDMARK_SUFFIX.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
      ")"
  ).test(t);
  if (!hasPlace && !KNOWN_POI.includes(t)) return "";
  return t;
}

/**
 * 从一段文本抽取位置候选。
 * @param {string} text 消息文本
 * @param {number} [limit=3] 最多返回候选数
 * @returns {Array<{text:string, query:string}>}
 */
export function extractLocations(text, limit = 3) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  const push = (raw) => {
    if (!raw) return;
    const q = normalize(raw);
    if (!q) return;
    // 去重：完全相同跳过；新候选是旧的子串 → 旧更具体，丢弃新；
    //       新候选包含旧 → 新更具体，替换旧（避免「杭州市西湖区」因含 POI「西湖」被丢）。
    for (let i = 0; i < out.length; i++) {
      const eq = out[i].query;
      if (eq === q) return;
      if (eq.includes(q)) return;
      if (q.includes(eq)) { out[i] = { text: String(raw).trim(), query: q }; return; }
    }
    out.push({ text: String(raw).trim(), query: q });
  };

  // 1. 已知 POI 直接命中
  for (const poi of KNOWN_POI) {
    if (text.includes(poi)) push(poi);
  }
  // 2. 行政/路名/地标片段
  let m;
  PLACE_RE.lastIndex = 0;
  while ((m = PLACE_RE.exec(text)) !== null) push(m[0]);
  // 3. 句式中的地点
  SENT_RE.lastIndex = 0;
  while ((m = SENT_RE.exec(text)) !== null) push(m[1]);

  return out.slice(0, limit);
}
