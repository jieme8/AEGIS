#!/usr/bin/env node
/**
 * 影视元数据检索服务 · J.A.R.V.I.S. Cyber Audio Spectrum
 *
 * 为什么需要它：现有 movie-search.mjs（8789）只做「片名 → Bing 直链深抠」，
 * 没有任何影片元数据底座，因此除片名外无法按 类型/地区/年份/演员/导演/评分/标签 检索，
 * 也没有模糊匹配与关联推荐。本服务补齐「发现层（Discovery）」：
 *
 *   1) 本地种子目录（server/movie-seed.json）：离线/沙箱下始终可用，覆盖多维度示例数据。
 *   2) 可选 TMDB 适配器：仅当设置 TMDB_API_KEY 且真机可达时启用，失败自动回退种子（绝不阻断）。
 *   3) 多条件 AND 组合过滤 + 标题模糊匹配（归一化 + 编辑距离）+ 评分/年份排序。
 *   4) 关联推荐（/api/movie/similar）：同导演/演员/标签/类型加权打分。
 *
 * 设计原则（对齐现有 movie-search.mjs 的诚实/健壮约定）：
 *   - 全程 try/catch，任何抓取异常返回空、不抛错中断主流程。
 *   - 密钥（TMDB_API_KEY）仅存服务端环境变量，绝不进前端 bundle。
 *   - 端口 8790，与现有 8789 完全隔离；本文件不修改任何现有模块。
 *
 * 接口（均经 Vite 同源代理 /api/movie/* 转发，避免 CORS）：
 *   GET /api/movie/health                       → { ok, source, count }
 *   GET /api/movie/search?q=&type=&region=&year=&yearFrom=&yearTo=&director=&cast=&minRating=&tag=&sort=&limit=
 *   GET /api/movie/meta?id=                      → 单条元数据
 *   GET /api/movie/similar?id=&limit=           → 关联推荐列表
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOVIE_META_PORT) || 8790;
const TMDB_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE = "https://api.themoviedb.org/3";

const log = (...a) => console.log("[movie-meta]", ...a);
const warn = (...a) => console.warn("[movie-meta]", ...a);

// —— 加载本地种子目录（始终可用）——
let SEED = [];
try {
  const raw = readFileSync(path.join(__dirname, "movie-seed.json"), "utf8");
  SEED = JSON.parse(raw).movies || [];
  log("本地种子目录已加载：", SEED.length, "部");
} catch (e) {
  warn("种子目录加载失败（将仅依赖 TMDB）：", e.message);
  SEED = [];
}

// —— 别名/译名消歧表（与 movie-search 共用）——
const ALIAS_MAP = new Map(); // 归一化别名 → { m, en }
try {
  const aliases = JSON.parse(readFileSync(path.join(__dirname, "alias-map.json"), "utf8")).aliases || [];
  for (const e of aliases) {
    for (const a of [e.m, ...(e.aliases || [])]) {
      const an = normalize(a || "");
      if (an && an.length >= 2) ALIAS_MAP.set(an, e);
    }
  }
  log("别名消歧表已加载：", ALIAS_MAP.size, "条");
} catch (e) {
  warn("别名表加载失败（仅影响名称消歧）：", e.message);
}

/** 规范化查询：命中别名 → 替换为规范主名（人读可辨，且提升种子/TMDB 命中）。 */
function canonicalizeQuery(q) {
  if (!q) return q;
  const e = ALIAS_MAP.get(normalize(q));
  if (e && normalize(e.m) !== normalize(q)) return e.m;
  return q;
}

// —— 归一化：小写、去空白与标点，保留 CJK 与字母数字 ——
function normalize(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

// —— 编辑距离（Levenshtein）——
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// —— 模糊标题匹配：归一化相等/包含/编辑距离阈值 ——
function titleFuzzyHit(qNorm, titleNorm) {
  if (!qNorm) return true;
  if (!titleNorm) return false;
  if (titleNorm === qNorm) return true;
  if (titleNorm.includes(qNorm) || qNorm.includes(titleNorm)) return true;
  const dist = levenshtein(qNorm, titleNorm);
  const maxLen = Math.max(qNorm.length, titleNorm.length) || 1;
  return dist / maxLen <= 0.34; // 容忍约 1/3 的字符差异（错别字/简称召回）
}

const has = (arr, v) => Array.isArray(arr) && arr.some((x) => normalize(x) === normalize(v));

/** 应用结构化过滤（AND）。filters 来自查询参数。 */
function applyFilters(list, f) {
  return list.filter((m) => {
    if (f.type && normalize(m.type) !== normalize(f.type)) return false;
    if (f.region && normalize(m.region) !== normalize(f.region)) return false;
    if (f.year && Number(m.year) !== Number(f.year)) return false;
    if (f.yearFrom && Number(m.year) < Number(f.yearFrom)) return false;
    if (f.yearTo && Number(m.year) > Number(f.yearTo)) return false;
    if (f.minRating && Number(m.rating) < Number(f.minRating)) return false;
    if (f.director && !(m.director && normalize(m.director).includes(normalize(f.director)))) return false;
    if (f.cast && f.cast.length && !f.cast.some((c) => (m.cast || []).some((mc) => normalize(mc).includes(normalize(c))))) return false;
    if (f.tag && !has(m.tags, f.tag)) return false;
    if (f.q) {
      const hitTitle = titleFuzzyHit(normalize(f.q), normalize(m.title));
      const hitOriginal = m.originalTitle && titleFuzzyHit(normalize(f.q), normalize(m.originalTitle));
      if (!hitTitle && !hitOriginal) return false;
    }
    return true;
  });
}

function sortResults(list, sort) {
  const arr = [...list];
  if (sort === "year") arr.sort((a, b) => Number(b.year) - Number(a.year));
  else arr.sort((a, b) => Number(b.rating) - Number(a.rating)); // 默认按评分
  return arr;
}

// —— 可选 TMDB 适配器：仅当有 key 且可达时启用，失败静默回退种子 ——
async function searchTMDB(q, f, ms = 6000) {
  if (!TMDB_KEY || !q) return { items: [], used: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const url = `${TMDB_BASE}/search/multi?api_key=${encodeURIComponent(TMDB_KEY)}&query=${encodeURIComponent(q)}&language=zh-CN`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { items: [], used: false };
    const data = await r.json();
    const items = (data.results || [])
      .filter((x) => x.media_type === "movie" || x.media_type === "tv")
      .map((x) => {
        const isMovie = x.media_type === "movie";
        const oc = (x.origin_country && x.origin_country[0]) || "";
        const region = oc === "US" || oc === "GB" || oc === "FR" ? "欧美"
          : oc === "KR" ? "日韩" : oc === "JP" ? "日韩" : oc === "CN" ? "大陆" : "欧美";
        return {
          id: "tmdb-" + x.id,
          title: x.title || x.name || "",
          originalTitle: x.original_title || x.original_name || "",
          type: isMovie ? "电影" : "剧集",
          region,
          year: Number((x.release_date || x.first_air_date || "").slice(0, 4)) || 0,
          rating: Number(x.vote_average) || 0,
          cast: [],
          director: "",
          tags: [],
          synopsis: x.overview || "",
          source: "tmdb",
        };
      });
    return { items, used: true };
  } catch (e) {
    warn("TMDB 检索不可用，回退种子：", e.message);
    return { items: [], used: false };
  } finally {
    clearTimeout(t);
  }
}

/** 按归一化标题去重（优先保留种子项，因其元数据更完整）。 */
function dedupe(seedItems, tmdbItems) {
  const seen = new Set();
  const out = [];
  for (const it of [...seedItems, ...tmdbItems]) {
    const key = normalize(it.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function handleSearch(params) {
  const f = {
    q: canonicalizeQuery((params.get("q") || "").trim()),
    type: (params.get("type") || "").trim(),
    region: (params.get("region") || "").trim(),
    year: (params.get("year") || "").trim(),
    yearFrom: (params.get("yearFrom") || "").trim(),
    yearTo: (params.get("yearTo") || "").trim(),
    director: (params.get("director") || "").trim(),
    cast: (params.get("cast") || "").split(",").map((s) => s.trim()).filter(Boolean),
    minRating: (params.get("minRating") || "").trim(),
    tag: (params.get("tag") || "").trim(),
  };
  const sort = (params.get("sort") || "rating").trim();
  const limit = Math.min(Number(params.get("limit") || 30) || 30, 100);

  const seedMatched = applyFilters(SEED, f);
  const tmdb = await searchTMDB(f.q, f);
  const merged = dedupe(seedMatched, tmdb.items);
  const sorted = withPoster(sortResults(merged, sort).slice(0, limit));

  const source = tmdb.used && tmdb.items.length ? "merged" : "seed";
  return {
    query: f.q,
    filters: f,
    source,
    total: sorted.length,
    seedTotal: SEED.length,
    results: sorted,
  };
}

function handleMeta(params) {
  const id = (params.get("id") || "").trim();
  const m = SEED.find((x) => x.id === id) || null;
  return m ? { movie: m } : { movie: null };
}

/** 关联推荐：同导演(+3)/同演员(+1每项)/同标签(+1每项)/同类型(+1)/同地区(+0.5)，排除自身。 */
function handleSimilar(params) {
  const id = (params.get("id") || "").trim();
  const limit = Math.min(Number(params.get("limit") || 8) || 8, 20);
  const base = SEED.find((x) => x.id === id);
  if (!base) return { base: null, recommendations: [] };
  const score = (m) => {
    let s = 0;
    if (m.director && base.director && normalize(m.director) === normalize(base.director)) s += 3;
    for (const c of m.cast || []) if (has(base.cast, c)) s += 1;
    for (const tg of m.tags || []) if (has(base.tags, tg)) s += 1;
    if (normalize(m.type) === normalize(base.type)) s += 1;
    if (normalize(m.region) === normalize(base.region)) s += 0.5;
    return s;
  };
  const recs = SEED
    .filter((m) => m.id !== base.id)
    .map((m) => ({ movie: m, score: score(m) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.movie.rating) - Number(a.movie.rating))
    .slice(0, limit)
    .map((x) => x.movie);
  return { base, recommendations: recs };
}

/** 生成竖版 SVG 海报 Data URL（离线、零外部依赖、每片不同视觉）。 */
function posterSVG(m) {
  const s = (x, n) => { const t = String(x == null ? "" : x); return t.length > n ? t.slice(0, n) + "…" : t; };
  const title = s(m.title || m.originalTitle || "影视", 9);
  const ot = s(m.originalTitle || "", 22);
  const type = String(m.type || "电影");
  const region = String(m.region || "");
  const year = String(m.year || "");
  const rating = m.rating != null ? String(m.rating) : "—";
  const first = (String(title).replace(/[（(【\[：:·.，。]/g, "") || "影").charAt(0);
  const palette = {
    "电影": ["#0b2a4a", "#123f6d", "#2b8ce6"],
    "剧集": ["#2c1550", "#45206e", "#9b5cff"],
    "动漫": ["#0d3d34", "#14645a", "#22c7a6"],
    "纪录片": ["#3a240a", "#5f3a12", "#e0a34e"],
    "综艺": ["#3d0d22", "#5f1230", "#f26d96"],
  };
  const [c1, c2, acc] = palette[type] || palette["电影"];
  const e = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const vline = (x) => `<line x1='${x}' y1='0' x2='${x}' y2='750'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='750' viewBox='0 0 500 750'>` +
    `<defs>` +
    `<linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${c1}'/><stop offset='100%' stop-color='${c2}'/></linearGradient>` +
    `<radialGradient id='glow' cx='50%' cy='36%' r='55%'><stop offset='0%' stop-color='${acc}' stop-opacity='0.38'/><stop offset='100%' stop-color='${acc}' stop-opacity='0'/></radialGradient>` +
    `</defs>` +
    `<rect width='500' height='750' fill='url(#bg)'/>` +
    `<rect width='500' height='750' fill='url(#glow)'/>` +
    `<g stroke='rgba(255,255,255,0.05)'>${vline(50)}${vline(130)}${vline(210)}${vline(290)}${vline(370)}${vline(450)}</g>` +
    `<g stroke='rgba(255,255,255,0.04)'><line x1='0' y1='150' x2='500' y2='150'/><line x1='0' y1='300' x2='500' y2='300'/><line x1='0' y1='450' x2='500' y2='450'/><line x1='0' y1='600' x2='500' y2='600'/></g>` +
    `<rect x='16' y='16' width='468' height='718' fill='none' stroke='${acc}' stroke-opacity='0.55'/>` +
    `<rect x='23' y='23' width='454' height='704' fill='none' stroke='rgba(255,255,255,0.22)'/>` +
    `<text x='250' y='300' font-size='250' font-family='PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif' fill='${acc}' fill-opacity='0.85' text-anchor='middle' dominant-baseline='central'>${e(first)}</text>` +
    `<text x='48' y='532' font-size='52' font-weight='700' font-family='PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif' fill='#ffffff'>${e(title)}</text>` +
    (ot ? `<text x='48' y='596' font-size='34' font-family='PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif' fill='rgba(255,255,255,0.78)'>${e(ot)}</text>` : "") +
    `<text x='48' y='676' font-size='34' font-family='PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif' fill='#ffd166'>★ ${e(rating)}</text>` +
    `<text x='262' y='676' font-size='30' text-anchor='middle' font-family='PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif' fill='rgba(255,255,255,0.72)'>${e(type)} · ${e(region)} · ${e(year)}</text>` +
    `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** 附带 SVG 海报到结果项。 */
function withPoster(items) {
  return (items || []).map((m) => ({ ...m, poster: posterSVG(m) }));
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readParams(req) {
  try {
    return new URL(req.url, "http://localhost").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/movie/health") {
      return sendJSON(res, 200, { ok: true, service: "movie-meta", source: SEED.length ? "seed" : "none", count: SEED.length });
    }
    if (req.method === "GET" && url.pathname === "/api/movie/search") {
      const result = await handleSearch(url.searchParams);
      return sendJSON(res, 200, result);
    }
    if (req.method === "GET" && url.pathname === "/api/movie/meta") {
      return sendJSON(res, 200, handleMeta(url.searchParams));
    }
    if (req.method === "GET" && url.pathname === "/api/movie/similar") {
      return sendJSON(res, 200, handleSimilar(url.searchParams));
    }
    sendJSON(res, 404, { error: "未找到接口：" + url.pathname });
  } catch (e) {
    warn("请求处理异常：", e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  log("影视元数据检索服务已启动： http://localhost:" + PORT);
  log("浏览器经 Vite 同源代理 /api/movie 访问；本地种子 " + SEED.length + " 部" + (TMDB_KEY ? "，TMDB 适配器已启用" : "，TMDB 未配置（仅种子）"));
});

const shutdown = () => {
  log("正在关闭…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
