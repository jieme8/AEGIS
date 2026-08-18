/**
 * 位置实体抽取器（对话自动地图标注 · 来源①）
 *
 * 设计原则（v2 收紧）：
 * 1. 加 **意图门槛**：纯闲聊、日常叙述不该触发地图。
 *    仅当文本含「位置查询意图」（在哪/怎么走/附近/天气/路线/距离/导航/查/介绍...）
 *    或命中 KNOWN_POI（高识别度地标直接视为查询对象）时，才进入抽取。
 * 2. 收紧 `LANDMARK_SUFFIX`：删掉日常对话里高频出现且通常与位置无关的词
 *    （医院/学校/大学/公司/小区/酒店/餐厅/公园/大厦/广场/购物中心/酒店/宾馆/工业园/科技园...），
 *    它们存在与否不代表用户想看地图。
 * 3. 个人叙述（"我家在 XX"/"我住 XX"）必须配查询意图才视为地点，
 *    日常聊天里"我家在北京"不应自动出地图。
 *
 * 输出：[{ text, query }]
 *  - text：原文命中的片段（用于地图标记 label）
 *  - query：送 maps_geo 的干净地址串
 */

// ---------- 意图关键词（命中任一即视为"用户在查位置"） ----------
// 覆盖：位置查询 / 路径 / 周边 / 天气 / 距离 / 导航 / 服务查询 / @命令
const QUERY_INTENT = [
  // 位置查询
  "在哪", "在哪里", "哪儿", "哪个位置", "地址", "位置",
  // 路径 / 出行
  "怎么走", "怎么去", "怎么到", "怎么到达", "路线", "路线图", "导航",
  "出发", "到达", "距离", "多远", "几公里", "几百米",
  "坐车", "乘车", "转车", "打车", "开车", "自驾", "步行", "骑行", "骑车",
  "地铁站", "公交站", "火车站", "高铁站", "机场",
  // 周边 / 搜索
  "附近", "周边", "周围", "附近的", "周边的",
  // 天气
  "天气", "气温", "几度", "下雨", "下雪", "风力", "湿度", "pm2.5", "空气质量",
  // 服务 / POI 查找
  "加油站", "停车场", "充电站", "派出所", "银行",
  "查一下", "查一查", "查查", "介绍一下", "介绍下", "推荐", "哪里有",
  // 命令 / 显式地图
  "@地图", "/map", "画地图", "贴地图", "标个地图",
];

// 行政/路名后缀（命中即视为位置候选）
// v2 大幅收紧：去掉日常对话高频词（医院/学校/公司/小区/酒店/餐厅/公园/大厦...）
// 留下来的都是 POI 关键字（如车站/机场/博物馆）或行政级别（省市区县乡村）。
const ADMIN_SUFFIX = ["省", "市", "区", "县", "镇", "乡", "村"];
const ROAD_SUFFIX = ["路", "街", "大道", "巷", "弄"];
const LANDMARK_SUFFIX = [
  "车站", "火车站", "高铁站", "机场", "地铁站",
  "博物馆", "图书馆", "体育馆",
];

// 知名 POI 白名单（直接命中，无需意图门）
const KNOWN_POI = [
  "西湖", "外滩", "天安门", "故宫", "东方明珠", "北京南站", "首都机场",
  "上海虹桥站", "杭州东站", "深圳北站", "广州南站", "浦东机场", "白云机场",
  "中关村", "陆家嘴", "三里屯", "西单", "王府井", "颐和园", "长城", "兵马俑",
];

// POI 默认所在城市。用于消歧：maps_geo("东方明珠") 会命中湖南邵阳同名点，
// 自动升级成 maps_geo("上海东方明珠") 才能稳定拿到上海陆家嘴那座。
// ctx（历史对话里的城市）可覆盖这里的默认值：例如用户问"广州的东方明珠" → "广州东方明珠"。
const POI_DEFAULT_CITY = {
  // 上海
  "外滩": "上海", "陆家嘴": "上海", "东方明珠": "上海", "上海虹桥站": "上海",
  "浦东机场": "上海",
  // 北京
  "天安门": "北京", "故宫": "北京", "北京南站": "北京", "首都机场": "北京",
  "中关村": "北京", "三里屯": "北京", "西单": "北京", "王府井": "北京",
  "颐和园": "北京", "长城": "北京", "兵马俑": "北京", // 兵马俑地理上在西安；用户语境常见"北京旅游"，若需求西安可移除
  // 杭州
  "西湖": "杭州", "杭州东站": "杭州",
  // 深圳
  "深圳北站": "深圳",
  // 广州
  "广州南站": "广州", "白云机场": "广州",
};

// 常用城市名（直接补全"杭州明天天气怎么样"里"杭州"不被 PLACE_RE 命中的问题）
// 仅收录全国主要地级市以上 + 知名旅游地，避免日常人名/品牌名误伤。
// 导出供 maybeShowMap 用：maps_text_search 时 city 参数从 query 里拆出。
export const KNOWN_CITY = [
  "北京", "上海", "天津", "重庆",
  "广州", "深圳", "杭州", "南京", "苏州", "宁波", "厦门", "福州",
  "成都", "武汉", "长沙", "西安", "青岛", "济南", "郑州", "合肥",
  "昆明", "大理", "丽江", "三亚", "海口", "拉萨",
  "兰州", "西宁", "乌鲁木齐", "贵阳", "南宁", "石家庄", "太原",
  "呼和浩特", "银川", "南昌", "沈阳", "大连", "哈尔滨", "长春",
  "无锡", "佛山", "东莞", "唐山", "邯郸", "保定", "秦皇岛",
  "洛阳", "开封", "敦煌", "桂林", "张家界", "九寨沟",
];

// 行政/路名/地标片段（中等粒度）
const PLACE_RE =
  /[一-龥]{1,12}(?:省|市|区|县|镇|乡|村)|[一-龥]{1,12}(?:路|街|大道|巷|弄)|[一-龥]{2,12}(?:车站|火车站|高铁站|机场|地铁站|博物馆|图书馆|体育馆)/g;

// 句式：在/去/到/从 + 地点 + 方位/动作词
// v2 收紧：去掉「到」避免「从 A 到 B」句式把"到"当成终止符截到 A
const SENT_RE = /(?:在|去|到|从|往)(.{2,10}?)(?:附近|旁边|边上|出发|怎么走|在哪里|在哪|坐车|乘车)/g;

const TRAILING_STOP =
  /(?:附近|旁边|边上|出发|怎么走|在哪里|在哪|坐车|乘车|玩|看看|旅游|旅行|的|吗|呢|吧|啊|呀|哦|嘛|咯)\s*$/;

// 个人叙述前缀：文本以「我/我家/我们…」开头时被识别为个人陈述，
// 但只有"个人前缀 + 完全无查询动词"才挡掉 KNOWN_POI 直击：
// "我家在北京市朝阳区" → 个人叙述 + 无查询动词 → 不视为查询
// "我想去北京南站接人" → 个人前缀 + "去"是查询动词 → 仍视为查询
const PERSONAL_PREFIX = /^\s*(?:我|我们|你|你们|他|他们|她|她们|它|它们|咱|咱们|我家|我们家|他们家|她家|你们家|我们大家)/;

// 查询动词：即使以个人代词开头，出现这些词仍视为查询
// 「在」刻意不放进来：太弱，"我在公司 / 他在家" 日常叙述也会含"在"。
const QUERY_VERB = /(?:去|到|从|往|回|怎么|几|介绍|推荐|查|搜索|怎么走|怎么去|哪里|在哪|哪儿)/;

/**
 * 检测文本是否含"位置查询意图"。
 * @returns {boolean}
 */
export function hasLocationIntent(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();

  // 命令/工具关键词：最高优先级
  if (/@地图|\/map/.test(t)) return true;

  // 通用意图关键词：任一命中即视为查询
  if (QUERY_INTENT.some((kw) => t.includes(kw))) return true;

  // KNOWN_POI 出现 → 通常意味着用户想了解它（视为查询对象）
  // 除非整段以「个人叙述前缀」开头（"我家在 XX"、"我住 XX"…）且全文无查询动词，
  // 这种情况下 POI 是被当作背景信息，不是查询目标。
  if (KNOWN_POI.some((p) => t.includes(p))) {
    if (PERSONAL_PREFIX.test(t) && !QUERY_VERB.test(t)) return false;
    return true;
  }

  return false;
}

function normalize(raw) {
  if (!raw) return "";
  let t = String(raw).trim();
  t = t.replace(/^(?:我|我们|你|你们|他|他们|她|她们|它|它们|咱|咱们)?(?:在|去|到|从|往|来|回|赴)\s*/, ""); // 去掉"我在/我们去"等前缀，保留纯地名
  t = t.replace(TRAILING_STOP, ""); // 去尾随方位/语气词
  if (t.length < 2) return "";
  // 行政/路名/地标后缀命中 → 视为地点
  const hasPlace = new RegExp(
    "(?:省|市|区|县|镇|乡|村|路|街|大道|巷|弄|" +
      LANDMARK_SUFFIX.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
      ")"
  ).test(t);
  // KNOWN_POI / KNOWN_CITY 直接通过（白名单地名，已知是地点）
  if (KNOWN_POI.includes(t) || KNOWN_CITY.includes(t)) return t;
  if (!hasPlace) return "";
  return t;
}

/**
 * 从一段文本抽取位置候选。
 * @param {string} text 消息文本
 * @param {object} [opts]
 * @param {boolean} [opts.requireIntent=true] 是否要求含查询意图。
 *   - false：绕过意图门槛（AI tool-loop 已经有明确工具调用上下文时可用）；
 *   - true（默认）：日常消息必须含意图关键词或命中 KNOWN_POI 才抽取。
 * @param {number} [opts.limit=3] 最多返回候选数
 * @param {string[]|string} [opts.ctx] 对话上下文（历史消息 / AI 回复拼接）。
 *   - 用来绑定已知城市（即使当前文本里没出现"上海"也能给"东方明珠"配城市前缀）。
 *   - 数组元素会被空格连接成一个字符串参与合并 pass；
 *   - ctx 里出现的城市会自动"压倒" POI 默认城市（用户显式说"广州东方明珠" → 用广州）。
 * @returns {Array<{text:string, query:string}>}
 */
export function extractLocations(text, opts = {}) {
  const { requireIntent = true, limit = 3 } =
    typeof opts === "number"
      ? { requireIntent: true, limit: opts } // 向后兼容：extractLocations(t, 3)
      : opts;
  let { ctx = [] } = typeof opts === "number" ? {} : opts;
  if (!Array.isArray(ctx)) ctx = [ctx];

  if (!text || typeof text !== "string") return [];

  // v2 收紧：必须有"位置查询意图"才进入抽取
  // 已知 POI 名（西湖/故宫...）和显式地图命令可绕过意图门
  if (requireIntent && !hasLocationIntent(text)) return [];

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
  // 1b. 常用城市名直接命中（补全"杭州明天天气怎么样"里"杭州"无后缀的丢失）
  for (const city of KNOWN_CITY) {
    if (text.includes(city)) push(city);
  }
  // 2. 行政/路名/地标片段
  let m;
  PLACE_RE.lastIndex = 0;
  while ((m = PLACE_RE.exec(text)) !== null) push(m[0]);
  // 3. 句式中的地点
  SENT_RE.lastIndex = 0;
  while ((m = SENT_RE.exec(text)) !== null) push(m[1]);

  // 4. 上下文合并：把 [上海, 外滩] 合并成 [上海外滩]。
  //    ctx 拼到 text 后面参与合并，让对话历史里出现的城市也能绑上当前 POI。
  //    例：当前 text="搜索东方明珠"，ctx=["上海浦东新区陆家嘴..."] → 把"东方明珠"升级成"上海东方明珠"。
  //    ctx 优先于 POI_DEFAULT_CITY：ctx=["广州"] + text="东方明珠" → "广州东方明珠"（不取默认上海）。
  const ctxStr = ctx.length ? ctx.filter(Boolean).join(" ") : "";
  // 从 ctx 里也捞一份 KNOWN_CITY，作为"外部 city"参与合并，让"text 里没出现 city 但 ctx 里有"的场景也能绑上。
  const ctxCities = ctxStr ? KNOWN_CITY.filter((c) => ctxStr.includes(c)) : [];
  const merged = combineCityWithPois(text + (ctxStr ? " " + ctxStr : ""), out, ctxCities);

  // 5. POI 默认城市兜底：合并 pass 仍可能留下独立 POI（ctx 里没有匹配城市）。
  //    这时用 POI_DEFAULT_CITY 映射给一个默认城市，避免 maps_geo("东方明珠") 命中湖南邵阳同名点。
  return applyPoiDefaultCity(merged, out).slice(0, limit);
}

/**
 * 给独立的 POI 候选应用 POI_DEFAULT_CITY 默认城市前缀。
 * 关键约束：**已被 ctx 合并过的 POI 不再应用默认**（ctx 优先）。
 * 判定方式：合并结果里 query 如果以 KNOWN_CITY 开头且长度 > CITY 长度，
 *           说明已是 "上海东方明珠" 形态（来自 ctx 合并或"同句合并"），保持原样。
 */
function applyPoiDefaultCity(merged, originalOut) {
  if (!merged || merged.length === 0) return merged;
  const result = [];
  for (const item of merged) {
    if (KNOWN_CITY.includes(item.query)) { result.push(item); continue; }
    // 已被合并（query 是 CITY+POI 复合形态）就不再加默认前缀
    const isComposite = KNOWN_CITY.some(
      (c) => item.query.startsWith(c) && item.query.length > c.length
    );
    if (isComposite) { result.push(item); continue; }
    // 仍未合并 → 用默认城市前缀升级成 "上海东方明珠" 这种复合查询
    const defaultCity = POI_DEFAULT_CITY[item.query];
    if (defaultCity) {
      const combined = defaultCity + item.query;
      if (!result.some((r) => r.query === combined)) {
        result.push({ text: item.text, query: combined });
        continue;
      }
    }
    result.push(item);
  }
  return result;
}

/**
 * 把 [上海, 外滩] 合并成 [上海外滩]。
 * 规则：对每个 POI 类候选（非 KNOWN_CITY），找它在 text 里出现之前最近的 KNOWN_CITY，合成 CITY+POI。
 * - 多个同名 POI（外滩）+ 多个城市 → 各自找到离自己最近的那个 CITY；
 * - CITY 已被并入某个 POI 后，就不再作为独立候选输出（避免"上海"+"上海外滩"两条同区域地图卡片）。
 * - 合并前必须保证 out 里至少有一个 CITY + 一个非 CITY POI，否则不做任何修改（避免误合并）。
 *
 * @param {string} text  当前查询文本（已与 ctx 拼好）
 * @param {Array} out    抽取出的候选
 * @param {string[]} [extraCities] 从 ctx 抽出的 KNOWN_CITY 列表（当前文本里没出现、但 ctx 里出现过）
 */
function combineCityWithPois(text, out, extraCities = []) {
  if (!out || out.length === 0) return out;
  const cityItems = out.filter((c) => KNOWN_CITY.includes(c.query));
  // 把 ctx 抽到的城市也并入 cityItems 池子（仅作为合并源，不直接出现在结果中）。
  // 这些城市不出现在 out 里，所以不会被标记为 used，但仍可参与对 POI 的合并。
  const allCityQueries = [...new Set([...cityItems.map((c) => c.query), ...extraCities])];
  if (allCityQueries.length === 0 || out.every((x) => KNOWN_CITY.includes(x.query))) return out;

  const merges = []; // { poiIdx, cityQuery, combinedQuery }
  // 区分两类 city：
  //   - inOutCities：出现在 out 里的 city（与 POI 在同一文本），原逻辑：city 必须在 POI 之前才合并；
  //   - ctxOnlyCities：仅出现在 ctx 里、out 里没出现的（ctx 提供的隐式城市），无视顺序，
  //     反正都是"对话上下文里出现过的城市"，直接绑定最近的 POI 即可。
  const inOutCities = new Set(cityItems.map((c) => c.query));
  out.forEach((item, idx) => {
    if (KNOWN_CITY.includes(item.query)) return; // 跳过纯城市
    const poiPos = text.indexOf(item.query);
    if (poiPos < 0) return;
    let bestCity = null;
    let bestDist = Infinity;
    for (const cQ of allCityQueries) {
      if (item.query.includes(cQ)) continue; // POI 已含该 CITY，跳过避免重复拼
      const cPos = text.indexOf(cQ);
      if (cPos < 0) continue;
      // ctx 提供的 city（不在 out 里）无视顺序；out 里的 city 必须出现在 POI 之前。
      const isCtxOnly = !inOutCities.has(cQ);
      if (!isCtxOnly && cPos > poiPos) continue;
      const d = Math.abs(poiPos - cPos);
      if (d < bestDist) { bestDist = d; bestCity = cQ; }
    }
    if (bestCity) {
      merges.push({ poiIdx: idx, cityQuery: bestCity, combinedQuery: bestCity + item.query });
    }
  });
  if (merges.length === 0) return out;

  const used = new Set();
  const result = [];
  for (let i = 0; i < out.length; i++) {
    if (used.has(i)) continue;
    const m = merges.find((x) => x.poiIdx === i);
    if (m) {
      used.add(i);
      // 找匹配 CITY 的另一条独立项也标记 used（仅针对 out 中的 cityItems；ctx 城市不在 out 里，无需 mark）
      for (let j = 0; j < out.length; j++) {
        if (j !== i && out[j].query === m.cityQuery && !used.has(j)) {
          used.add(j);
          break;
        }
      }
      if (!result.some((r) => r.query === m.combinedQuery)) {
        result.push({ text: m.combinedQuery, query: m.combinedQuery });
      }
    } else {
      result.push(out[i]);
    }
  }
  return result;
}
