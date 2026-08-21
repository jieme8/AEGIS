// src/lib/answerVerifier.js
// =====================================================================
// 答案校验引擎 · 内容生成后「溯源 / 可验证」机制的核心
// ---------------------------------------------------------------------
// 设计目标（对应产品「事实准确性为最高优先级」要求）：
//   1) 不确定 / 无依据 → 检测模型是否显式声明不确定性；
//   2) 创意 / 虚构内容 → 检测「以下为虚构创作」标注是否就位；
//   3) 知识时效边界 → 注入模型训练时效说明（前端常量，prompt 同时要求模型自声明）；
//   4) 信息来源 URL + 可信度 → 抽取并分级（官方/权威/媒体/未知）；
//   5) 高利害断言（数字/百分比/日期/引用/统计/政策）是否附来源 → 覆盖率。
// 产出：可信度等级 + 评分 + 警告 + 来源清单，供气泡脚注与 trace 浮层实时消费。
// 说明：本引擎为前端启发式校验，不能替代真实联网检索；它让「模型自陈依据」可见、可核。
// =====================================================================

// —— 模型知识时效边界（前端注入；prompt 同步要求模型主动声明自身 cutoff）——
export const KNOWLEDGE_BOUNDARY =
  "模型训练知识有截止日期，无法获取实时数据（行情 / 天气 / 突发新闻等），涉及最新事实请以权威来源为准。";

// —— 时效敏感问题特征（命中即有「数据可能过期」风险，需强制溯源判定）——
export const TIME_SENSITIVE_RE =
  /最新|实时|现在|当前|今年|本年度|最近|刚刚|今日|今天|本周|本月|202[4-9]年|20\d{2}(年)?度|上调|下调|调整|发布|公布|公布.*(数据|工资|标准)|生效|截止|社平|平均工资|基数/;

// —— 可信度分级（来源域名 → 等级）——
export const TRUST = {
  official:      { key: "official",      label: "官方 / 权威机构", short: "权威", cls: "t-official" },
  authoritative: { key: "authoritative", label: "权威媒体 / 学术", short: "可信", cls: "t-auth" },
  media:         { key: "media",         label: "一般媒体 / 站点", short: "媒体", cls: "t-media" },
  unknown:       { key: "unknown",       label: "未知来源",        short: "未知", cls: "t-unknown" },
};

// —— 最终可信度等级（答案整体）——
export const LEVEL_META = {
  high:    { key: "high",    label: "高 · 可溯源",   cls: "lv-high" },
  medium:  { key: "medium",  label: "中 · 部分可验证", cls: "lv-medium" },
  low:     { key: "low",     label: "低 · 需谨慎",   cls: "lv-low" },
  fiction: { key: "fiction", label: "虚构 · 已声明",  cls: "lv-fiction" },
};

// —— 官方 / 权威域名关键词（命中其一即视为高可信）——
const OFFICIAL_HOSTS = [
  "gov.cn", "edu.cn", "gov", "edu", "who.int", "un.org", "unesco.org", "nasa.gov",
  "nih.gov", "ieee.org", "iso.org", "iana.org", "w3.org", "ietf.org", "oecd.org",
  "imf.org", "worldbank.org", "sec.gov", "fda.gov", "cdc.gov", "nist.gov",
  "europa.eu", "state.gov", "whitehouse.gov", "gov.uk", "parliament.uk",
  "bundesregierung.de", "navy.mil", "army.mil", "nasa.gov",
];
const AUTHORITATIVE_HOSTS = [
  "wikipedia.org", "wikimedia.org", "baike.baidu.com", "reuters.com", "apnews.com",
  "xinhuanet.com", "people.com.cn", "news.cn", "bbc.com", "bbc.co.uk", "nature.com",
  "science.org", "sciencemag.org", "arxiv.org", "cell.com", "nejm.org", "thelancet.com",
  "pnas.org", "jstor.org", "cnki.net", "statista.com", "acm.org", "nytimes.com",
  "wsj.com", "ft.com", "economist.com", "caixin.com", "bloomberg.com", "nasdaq.com",
  "finance.yahoo.com", "finance.sina.com.cn", "github.com", "developer.mozilla.org",
  "docs.oracle.com", "docs.microsoft.com", "cloud.google.com", "aws.amazon.com",
  "openai.com", "deepmind.com", "docs.python.org", "developer.android.com",
  "apple.com", "intel.com", "amd.com", "nvidia.com", "tsmc.com",
];

// —— 不确定性强声明（出现即视为已诚实声明局限）——
const UNCERTAIN_STRONG = [
  "不确定", "无法确定", "尚不清楚", "暂无定论", "没有足够", "无法确认",
  "缺乏依据", "缺乏可靠", "无法获取实时", "不能保证", "仅供参考",
  "请以官方", "请以权威", "建议查阅", "建议核实", "无法核实", "未找到权威",
  "我的知识截止", "知识截止", "训练数据", "截至我", "截止到我", "时效",
  "我无法确认", "我无法保证", "可能不准确",
];

// —— 高利害断言特征（命中需附来源）——
const HS_NUMBER =
  /\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(%|％|亿元|万元|亿|万|公里|千米|米|厘米|吨|千克|公斤|平方|立方|倍|个|人|次|条|项|GHz|MHz|Hz|GB|MB|TB|kg|km|cm|mm|°C|摄氏度|美元|元|欧元|英镑)/;
const HS_YEAR = /(?:19|20)\d{2}\s?年|(?:19|20)\d{2}(?=[-/年])/;
const HS_QUOTE = /[“"”'‘’「」]/;
const HS_PHRASE =
  /(根据|据|研究显示|据统计|数据表明|报告称|官方|政府|法律|法规|条例|标准|协议|同比|环比|上涨|下降|下调|增长|提升|预计|截止|截至|援引|证实|宣布|发布|披露|修订)/;

// —— URL 抽取（同时处理裸链接与 Markdown [文本](url)）——
function extractUrls(text) {
  const found = [];
  const md = [...text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)];
  md.forEach((m) => found.push({ url: m[1], viaMarkdown: true }));
  // 去掉 markdown 链接语法，避免裸 URL 重复命中
  const stripped = text.replace(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, "$1");
  const bare = [...stripped.matchAll(/https?:\/\/[^\s<>"')}\]]+/g)];
  bare.forEach((m) => found.push({ url: m[0], viaMarkdown: false }));
  const seen = new Set();
  return found.filter((o) => {
    if (seen.has(o.url)) return false;
    seen.add(o.url);
    return true;
  });
}

function classifyTrust(host) {
  if (!host) return TRUST.unknown;
  const h = host.toLowerCase();
  const ends = (suf) => h === suf || h.endsWith("." + suf);
  if (OFFICIAL_HOSTS.some(ends)) return TRUST.official;
  if (AUTHORITATIVE_HOSTS.some(ends)) return TRUST.authoritative;
  if (/\.(gov|edu)$/.test(h)) return TRUST.authoritative; // .gov/.edu 机构偏向可信
  if (/\.org$/.test(h)) return TRUST.media;               // 一般 .org 未必权威
  return TRUST.media;                                      // 默认一般媒体 / 站点
}

function splitSentences(text) {
  return text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 判定单句是否为「需要来源的高利害断言」
function isHighStakes(s) {
  const isYear = HS_YEAR.test(s);
  const isNum = HS_NUMBER.test(s);
  const isQuote = HS_QUOTE.test(s);
  const isPhrase = HS_PHRASE.test(s);
  // 年份/百分比/金额等需配合上下文（数字或事实性短语）才计为高利害，避免闲聊误判
  if ((isYear && (isNum || isPhrase)) || isQuote || (isNum && isPhrase)) return true;
  // 直接以引号开头且含数字（如“2024年GDP为…”）
  if (/^["“]/.test(s) && isNum) return true;
  return false;
}

/**
 * 完整校验：传入 AI 终态文本，产出可追溯报告。
 * @param {Object} p
 * @param {string} p.text         AI 回复全文
 * @param {string} [p.model]      模型标识
 * @param {number} [p.sentAt]     请求发送时间戳
 * @param {string} [p.query]      用户原始问题（用于时效敏感判定）
 * @param {boolean} [p.timeSensitive] 上游已标记的时效敏感问题
 * @returns {Object} 校验报告
 */
export function verifyAnswer({ text, model, sentAt, query, timeSensitive }) {
  const content = String(text || "");
  // 时效敏感判定：上游显式标记优先，否则按问题文本特征兜底
  const timeSensitiveFlag = !!timeSensitive || TIME_SENSITIVE_RE.test(String(query || ""));
  const urls = extractUrls(content).map((o) => {
    let host = "";
    try { host = new URL(o.url).hostname; } catch (e) { /* 非法 URL */ }
    return { ...o, host, trust: classifyTrust(host) };
  });

  const fictionalLabel = /(以下为虚构创作|以下为创作|【虚构创作】|（虚构创作）|虚构内容声明|本内容为虚构|本回答为虚构)/.test(content);
  const uncertain = UNCERTAIN_STRONG.filter((p) => content.includes(p));
  const hasUncertainty = uncertain.length > 0;

  // 高利害断言逐句扫描
  const highStakes = [];
  for (const s of splitSentences(content)) {
    if (isHighStakes(s)) {
      const cited = /https?:\/\//.test(s);
      highStakes.push({ snippet: s.length > 80 ? s.slice(0, 80) + "…" : s, cited });
    }
  }
  const required = highStakes.length;
  const cited = highStakes.filter((h) => h.cited).length;

  // —— 评分（0-100）——
  let score = 60;
  if (fictionalLabel) {
    score = 72; // 虚构内容已声明即合规，事实性要求降低
  } else {
    const authSources = urls.filter(
      (u) => u.trust.key === "official" || u.trust.key === "authoritative"
    ).length;
    score += Math.min(25, authSources * 12); // 权威来源加持
    if (hasUncertainty && urls.length === 0) score += 10; // 诚实声明不确定，加分
    if (required > 0) {
      const coverage = cited / required;
      score -= Math.round((1 - coverage) * 30); // 未溯源的高利害断言扣分
    }
    // 时效敏感问题兜底：数值断言却一个真实来源都没有 → 大额扣分（数据可能过期 / 幻觉）
    if (timeSensitiveFlag && required > 0 && urls.length === 0) score -= 25;
  }
  score = Math.max(5, Math.min(100, score));

  // —— 等级 ——
  let level;
  if (fictionalLabel) level = "fiction";
  else if (required > 0 && cited < required && !hasUncertainty) level = "low";
  else if (score >= 75) level = "high";
  else if (score >= 50) level = "medium";
  else level = "low";
  // 时效敏感问题 + 数值断言 + 无任何来源链接 → 强制降到最低置信等级（数据可能过期 / 虚构）
  if (timeSensitiveFlag && !fictionalLabel && required > 0 && urls.length === 0) {
    level = "low";
  }

  // —— 警告 ——
  const warnings = [];
  if (!fictionalLabel && required > 0 && cited < required && !hasUncertainty) {
    warnings.push(
      `有 ${required - cited} 处关键事实陈述（数字 / 日期 / 引用）未附来源，且未声明不确定性，可信度偏低，请补充依据或明确局限。`
    );
  }
  if (!fictionalLabel && required === 0 && urls.length === 0 && !hasUncertainty && content.length > 40) {
    warnings.push("纯陈述性回复未提供任何来源、亦未声明不确定性；如涉及具体事实，请补充依据或明确知识边界。");
  }
  if (timeSensitiveFlag && !fictionalLabel && required > 0 && urls.length === 0) {
    warnings.push(
      "⚠️ 时效数据风险：该问题涉及最新/当前信息，但回复中的具体数值未附任何可点击来源，疑似基于训练记忆的旧值或幻觉，请以官方最新发布为准。"
    );
  }
  if (urls.some((u) => u.trust.key === "unknown")) {
    warnings.push("存在无法判定可信度的来源，请自行甄别。");
  }
  if (fictionalLabel) {
    warnings.push("已声明为虚构创作：内容非事实，仅供创意参考，不应作为现实依据。");
  }

  return {
    model: model || "—",
    sentAt: sentAt || null,
    knowledgeBoundary: KNOWLEDGE_BOUNDARY,
    timeSensitive: timeSensitiveFlag,
    sources: urls,
    sourceCount: urls.length,
    hasUncertainty,
    uncertaintyPhrases: uncertain,
    fictionalLabel,
    highStakes,
    required,
    cited,
    coverage: required ? Math.round((cited / required) * 100) : 100,
    score,
    level,
    warnings,
  };
}

/**
 * 流式期间轻量抽取（仅来源，用于实时显示「校验中… 已捕获 N 个来源」）。
 * 不跑完整评分，降低每个 token 的开销。
 */
export function extractLiveSources(text) {
  const urls = extractUrls(String(text || "")).map((o) => {
    let host = "";
    try { host = new URL(o.url).hostname; } catch (e) { /* ignore */ }
    return { ...o, host, trust: classifyTrust(host) };
  });
  return urls;
}
