/**
 * 影视元数据检索 · 前端库（纯函数，无 UI 依赖，零侵入现有 movieSearch.js）
 *
 * 职责：
 *   1) parseMovieQuery(text)        —— 把自然语言（如「2019 科幻 诺兰」「诺兰导演的科幻片」）
 *                                       解析为 { title, filters }；纯片名也兼容（filters 为空）。
 *   2) buildSearchParams(filters)   —— 把 filters 序列化为 /api/movie/search 查询串。
 *   3) searchMoviesMeta(filters)    —— 调同源代理 /api/movie/search，失败静默回退空结果（不崩现有功能）。
 *   4) getSimilarMovies(id)         —— 调 /api/movie/similar 取关联推荐。
 *
 * 设计对齐「保证现有功能不出问题」：
 *   - 本文件为全新模块，不修改 movieSearch.js / useChatController.js。
 *   - 所有网络调用 try/catch，代理不可达时返回安全的空结构，绝不影响既有 @影视搜索 链接流。
 */

// —— 类型关键词映射（命中即设为 filters.type）——
const TYPE_MAP = [
  { words: ["电影", "影片", "大电影"], type: "电影" },
  { words: ["剧集", "电视剧", "连续剧", "国产剧"], type: "剧集" },
  { words: ["动漫", "动画", "番剧", "番"], type: "动漫" },
  { words: ["纪录片", "记录片"], type: "纪录片" },
  { words: ["综艺", "真人秀"], type: "综艺" },
];

// —— 复合词：同时带出 type + region（如「美剧」「韩剧」）——
const COMPOSITE = [
  { re: /美剧/, type: "剧集", region: "欧美" },
  { re: /韩剧/, type: "剧集", region: "日韩" },
  { re: /日剧/, type: "剧集", region: "日韩" },
  { re: /港剧|台剧/, type: "剧集", region: "港台" },
];

// —— 地区关键词映射 ——
const REGION_MAP = [
  { words: ["大陆", "国产", "内地"], region: "大陆" },
  { words: ["港台", "香港", "台湾"], region: "港台" },
  { words: ["欧美", "美国", "英国", "法国"], region: "欧美" },
  { words: ["日韩", "日本", "韩国"], region: "日韩" },
];

// —— 标签词表（命中即加入 filters.tags）——
const TAG_VOCAB = [
  "科幻", "悬疑", "爱情", "喜剧", "剧情", "动作", "犯罪", "奇幻", "冒险",
  "音乐", "古装", "历史", "自然", "美食", "运动", "战争", "惊悚", "家庭",
  "青春", "恐怖", "灾难", "传记",
];

// —— 已知导演名录（取自种子库，用于目录感知解析：裸名字如「诺兰」归入导演）——
const KNOWN_DIRECTORS = [
  "克里斯托弗·诺兰", "奉俊昊", "陈凯歌", "弗兰克·德拉邦特", "宫崎骏", "拜伦·霍华德",
  "郭帆", "刘伟强", "詹姆斯·卡梅隆", "弗朗西斯·福特·科波拉", "彼得·威尔", "李·昂克里奇",
  "姜文", "朱塞佩·托纳多雷", "丹尼斯·维伦纽瓦", "关家永", "戴维·贝尼奥夫", "文斯·吉利根",
  "郑晓龙", "申源浩", "辛爽", "孙皓", "约翰·伦克", "萨维里奥·科斯坦佐", "安吉镐",
  "荒木哲郎", "古桥一浩", "外崎春雄", "阿拉斯泰尔·福瑟吉尔", "陈晓卿",
  "伊丽莎白·柴·瓦沙瑞莉", "陆伟", "赵浩",
  "新海诚", "昆汀·塔伦蒂诺", "大卫·芬奇", "文牧野", "张艺谋", "孔笙", "张永新",
  "田晓鹏", "谢君伟", "保罗·金", "黄东赫", "罗伯特·泽米吉斯", "周申", "林君阳", "朴性厚",
];

/** 从候选标题文本中解析已知导演名（补全/消歧）。返回 {name, rest} 或 null。 */
function resolveName(rest, known) {
  const restN = normalize(rest);
  if (restN.length < 2) return null;
  for (const full of known) {
    const fullN = normalize(full);
    if (!fullN) continue;
    if (restN.includes(fullN)) {
      const idx = rest.indexOf(full);
      const newRest = (idx >= 0 ? rest.slice(0, idx) + rest.slice(idx + full.length) : rest).trim();
      return { name: full, rest: newRest };
    }
    if (fullN.includes(restN)) {
      return { name: full, rest: "" };
    }
  }
  return null;
}

// —— 剔除非检索意义的 filler 词 ——
const FILLERS = [
  "的", "了", "啊", "呢", "吧", "吗", "请", "帮", "我", "你", "他", "她",
  "找", "搜", "查", "询", "推荐", "一部", "有没有", "有哪些", "什么", "哪些",
  "查一下", "搜一下", "看一下", "想看", "看", "有", "要", "是", "在", "和",
  "与", "及", "、", "，", ",", "。", "年", "以后", "之前", "以前", "往上", "以上", "起",
  "导演", "主演", "演员", "评分", "分", "高分", "片", "剧",
];

function stripAll(s, tokens) {
  let out = s;
  for (const t of tokens) {
    if (!t) continue;
    out = out.split(t).join("");
  }
  return out;
}

// —— 归一化：小写、去空白与标点，保留 CJK 与字母数字（与服务端一致）——
function normalize(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * 解析自然语言为结构化过滤器。
 * @param {string} text
 * @returns {{title:string, filters:object}}
 */
export function parseMovieQuery(text) {
  if (typeof text !== "string") return { title: "", filters: {} };
  let s = text.trim();
  const filters = {};
  const consumed = []; // 已识别的片段，后续从标题中剔除

  // —— 年份区间 / 单年 / 前后 ——
  let m;
  if ((m = s.match(/(\d{4})\s*[-~到至]\s*(\d{4})/))) {
    filters.yearFrom = m[1];
    filters.yearTo = m[2];
    consumed.push(m[0]);
  } else if ((m = s.match(/(\d{4})\s*年?\s*(?:以后|之后|后)/))) {
    filters.yearFrom = m[1];
    consumed.push(m[0]);
  } else if ((m = s.match(/(\d{4})\s*年?\s*(?:以前|之前|前)/))) {
    filters.yearTo = m[1];
    consumed.push(m[0]);
  } else if ((m = s.match(/\b(19|20)\d{2}\b/))) {
    filters.year = m[0];
    consumed.push(m[0]);
  }

  // —— 复合词（type + region）——
  for (const c of COMPOSITE) {
    if (c.re.test(s)) {
      filters.type = c.type;
      filters.region = c.region;
      consumed.push(s.match(c.re)[0]);
    }
  }

  // —— 类型 ——
  if (!filters.type) {
    for (const t of TYPE_MAP) {
      const hit = t.words.find((w) => s.includes(w));
      if (hit) { filters.type = t.type; consumed.push(hit); break; }
    }
  }

  // —— 地区 ——
  if (!filters.region) {
    for (const r of REGION_MAP) {
      const hit = r.words.find((w) => s.includes(w));
      if (hit) { filters.region = r.region; consumed.push(hit); break; }
    }
  }

  // —— 评分 ——
  let minRating = 0;
  if (/高分/.test(s)) { minRating = Math.max(minRating, 8.5); consumed.push("高分"); }
  if ((m = s.match(/(?:评分|分数|分)\s*[>=≥＞大于或等于]*\s*(\d(?:\.\d)?)/))) {
    minRating = Math.max(minRating, Number(m[1]));
    consumed.push(m[0]);
  }
  if ((m = s.match(/(\d(?:\.\d)?)\s*分(?:以上|往上|起)?/))) {
    minRating = Math.max(minRating, Number(m[1]));
    consumed.push(m[0]);
  }
  if (minRating > 0) filters.minRating = String(minRating);

  // —— 导演：优先「姓名+导演」，其次「导演+姓名」；姓名去除前导语气词 ——
  const nameRe = "([\\u4e00-\\u9fa5A-Za-z·]{2,8})";
  let dm;
  if ((dm = s.match(new RegExp(nameRe + "\\s*导演")))) {
    const nm = dm[1].replace(/^[的了啊]+/, "");
    if (nm.length >= 2) { filters.director = nm; consumed.push(dm[0]); }
  }
  if (!filters.director && (dm = s.match(new RegExp("导演[:：]?\\s*" + nameRe)))) {
    const nm = dm[1].replace(/^[的了啊]+/, "");
    if (nm.length >= 2) { filters.director = nm; consumed.push(dm[0]); }
  }
  // —— 主演 / 演员 ——
  let cm;
  if ((cm = s.match(/主演[:：]?\s*([^，,；;。\s]+(?:[、，,][^，,；;。\s]+)*)/))) {
    filters.cast = cm[1].split(/[、，,]/).map((x) => x.trim()).filter(Boolean);
    consumed.push(cm[0]);
  } else if ((cm = s.match(/演员[:：]?\s*([^，,；;。\s]+(?:[、，,][^，,；;。\s]+)*)/))) {
    filters.cast = cm[1].split(/[、，,]/).map((x) => x.trim()).filter(Boolean);
    consumed.push(cm[0]);
  }

  // —— 标签 ——
  const tags = [];
  for (const tg of TAG_VOCAB) {
    if (s.includes(tg)) { tags.push(tg); consumed.push(tg); }
  }
  if (tags.length) filters.tags = tags;

  // —— 剩余即标题：剔除已识别片段与 filler ——
  let rest = s;
  rest = stripAll(rest, consumed);
  rest = stripAll(rest, FILLERS);
  rest = rest.replace(/\s+/g, " ").trim();

  // —— 目录感知解析：leftover 命中已知导演 → 归入导演（补全/消歧）——
  if (!filters.director) {
    const r = resolveName(rest, KNOWN_DIRECTORS);
    if (r) { filters.director = r.name; rest = r.rest.replace(/\s+/g, " ").trim(); }
  }
  const title = rest;

  return { title, filters };
}

/** 把 filters 序列化为查询串（tags 用逗号拼接；cast 用逗号拼接）。 */
export function buildSearchParams(filters = {}) {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.type) p.set("type", filters.type);
  if (filters.region) p.set("region", filters.region);
  if (filters.year) p.set("year", filters.year);
  if (filters.yearFrom) p.set("yearFrom", filters.yearFrom);
  if (filters.yearTo) p.set("yearTo", filters.yearTo);
  if (filters.director) p.set("director", filters.director);
  if (filters.cast && filters.cast.length) p.set("cast", filters.cast.join(","));
  if (filters.minRating) p.set("minRating", filters.minRating);
  if (filters.tags && filters.tags.length) p.set("tag", filters.tags.join(","));
  if (filters.sort) p.set("sort", filters.sort);
  if (filters.limit) p.set("limit", String(filters.limit));
  return p.toString();
}

/** 调用 /api/movie/search；代理不可达时返回安全空结构。 */
export async function searchMoviesMeta(filters = {}, { timeoutMs = 12000 } = {}) {
  const qs = buildSearchParams(filters);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`/api/movie/search?${qs}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { results: [], total: 0, source: "error", seedTotal: 0 };
    const data = await res.json();
    return {
      results: Array.isArray(data.results) ? data.results : [],
      total: data.total || 0,
      source: data.source || "seed",
      seedTotal: data.seedTotal || 0,
      filters: data.filters || filters,
      query: data.query || filters.q || "",
    };
  } catch (e) {
    // 静默回退：不影响现有 @影视搜索 链接流
    return { results: [], total: 0, source: "offline", seedTotal: 0, error: e && e.message };
  }
}

/** 调用 /api/movie/similar；不可达返回空。 */
export async function getSimilarMovies(id, { limit = 8, timeoutMs = 12000 } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`/api/movie/similar?id=${encodeURIComponent(id)}&limit=${limit}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.recommendations) ? data.recommendations : [];
  } catch {
    return [];
  }
}
