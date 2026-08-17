#!/usr/bin/env node
/**
 * 影视搜索代理 · J.A.R.V.I.S. Cyber Audio Spectrum
 *
 * 为什么需要它：浏览器直接抓取第三方站点会遭遇 CORS，且抓取逻辑不宜进入前端 bundle。
 * 本服务在 Node 侧实现「影视搜索v4.1」工作流的真实检索：
 *
 *   实时检索（核心）：用用户给出的片名直接查询 Bing（setlang=zh-CN&cc=CN），
 *   解析结果页（b_algo 块）抽取真实「标题 + 直链 + 摘要」，去重并按相关性排序，
 *   置顶为「实时检索结果」分组返回。整页同时扫描 magnet: 链接一并回传。
 *
 *   检索入口（补充）：知识库/搜索引擎/磁力聚合/网盘 的分层入口（在用户浏览器侧打开），
 *   用于实时结果不足时手动深挖磁力 / 网盘资源。
 *
 * 诚实原则：绝不伪造磁力哈希；live 分组仅包含真实检索命中或真实提取的链接，标注「需验证」。
 *
 * 接口： GET /api/moviesearch?q=<影视名称>
 *        成功：200 JSON { query, summary, groups, tips, warnings, live }
 *        q 为空：400 { error }
 * 端口：  MOVIE_SEARCH_PORT（默认 8789），由 Vite 同源代理 /api/moviesearch 转发。
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOVIE_SEARCH_PORT) || 8789;

const log = (...a) => console.log("[movie-search]", ...a);
const warn = (...a) => console.warn("[movie-search]", ...a);

const enc = (s) => encodeURIComponent(s);
const MAGNET_RE = /magnet:\?xt=urn:btih:[A-Za-z0-9]+/gi;

// —— 站点定义（检索入口层，在用户浏览器侧打开）——
const KB_SITES = [
  {
    name: "枫叶网 fx57.cn",
    base: "https://www.fx57.cn/?s=",
    desc: "动漫专站，更新及时，含国语配音与中文字幕；点击直达站点检索页。",
  },
];
const SEARCH_ENGINES = [
  { name: "百度", base: "https://www.baidu.com/s?wd=", suffix: " 磁力 种子 4K 1080P BT 下载" },
  { name: "Bing", base: "https://www.bing.com/search?q=", suffix: " 磁力 种子 4K 1080P BT 下载" },
  { name: "Google", base: "https://www.google.com/search?q=", suffix: " magnet torrent 4K 1080P download" },
];
const MAGNET_SITES = [
  { name: "BT4G 磁力索引", base: "https://bt4gprx.com/search?q=" },
  { name: "TorrentKitty", base: "https://www.torrentkitty.tv/search?q=" },
];
const CLOUD_SITES = [
  { name: "百度网盘检索", base: "https://www.baidu.com/s?wd=", suffix: " 网盘 资源 提取码" },
];

/** 带超时的文本抓取；任何异常（网络/证书/超时）返回空串，绝不抛错中断主流程。 */
async function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
    });
    if (!r.ok) return "";
    return await r.text();
  } catch (e) {
    return "";
  } finally {
    clearTimeout(t);
  }
}

/** 解析 Bing 结果页，抽取真实标题/直链/摘要 + 整页 magnet 链接。 */
function parseBingResults(html, name) {
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  const seen = new Set();
  const items = [];

  // 整页扫描真实磁力链接（来自检索结果页内嵌资源）
  const magSet = new Set();
  let mm;
  const magRe = new RegExp(MAGNET_RE);
  while ((mm = magRe.exec(html)) !== null) magSet.add(mm[0]);

  for (const b of blocks) {
    const h2 = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!h2) continue;
    let href = h2[1];
    if (!/^https?:\/\//i.test(href)) {
      const dec = decodeBingUrl(href);
      if (dec) href = dec;
      else continue;
    }
    let host = "";
    try {
      const u = new URL(href);
      host = u.hostname;
      if (/bing\.com|microsoft\.com|msn\.com/i.test(host)) continue; // 跳过 Bing 自身
    } catch {
      continue;
    }
    const title = h2[2].replace(/<[^>]+>/g, "").trim();
    if (!title) continue;
    const snipM = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const meta = snipM
      ? snipM[1].replace(/<[^>]+>/g, "").replace(/&ensp;|&#0183;|&nbsp;/g, " ").trim().slice(0, 160)
      : "";
    const key = host + "|" + title;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreResult(title, host, meta, name);
    items.push({
      title,
      url: href,
      rating: ratingFor(score),
      meta: meta || `来自 ${host} 的检索命中。`,
      flags: flagsFor(title, meta),
      source: "Bing 实时检索",
      _score: score,
    });
  }

  items.sort((a, b) => b._score - a._score);

  const magnets = [...magSet].slice(0, 6).map((mg, i) => ({
    title: `${name} · 磁力链接 #${i + 1}`,
    url: mg,
    rating: "需验证",
    meta: "从检索结果页实时提取的磁力链接，做种情况以发布页为准，请自行验证。",
    flags: ["需验证做种情况"],
    source: "Bing 实时检索",
  }));

  return { items: items.slice(0, 10).map(({ _score, ...rest }) => rest), magnets };
}

/** 相关性打分：流媒体/豆瓣/百科优先，含磁力线索加分，片名命中加分。 */
function scoreResult(title, host, meta, name) {
  let s = 0;
  const t = (title + " " + meta).toLowerCase();
  if (title.includes(name) || name.startsWith(title.slice(0, 2))) s += 5;
  const good = [
    /douban\.com/, /baike\.baidu/, /iqiyi\.com/, /youku\.com/, /bilibili\.com/,
    /v\.qq\.com/, /tencent/, /1905\.com/, /mgtv\.com/, /imdb\.com/,
  ];
  if (good.some((re) => re.test(host))) s += 4;
  if (/磁力|magnet|bt|种子|下载|网盘|pan\.baidu|资源|在线|播放|迅雷|ed2k/.test(t)) s += 3;
  if (/zhihu|tieba|sina|sohu|douyin|weibo|so\.youku|so\.iqiyi/.test(host)) s += 1;
  return s;
}

function ratingFor(score) {
  if (score >= 8) return "优秀";
  if (score >= 4) return "良好";
  return "一般";
}

function flagsFor(title, meta) {
  const t = (title + " " + meta).toLowerCase();
  const f = [];
  if (/磁力|magnet|bt|种子/.test(t)) f.push("含磁力线索");
  if (/网盘|pan\.baidu/.test(t)) f.push("含网盘线索");
  if (/在线|播放|观看/.test(t)) f.push("可在线观看");
  return f;
}

/** 解析 Bing 重定向链接（/ck/a?...&u=a1<base64>）。 */
function decodeBingUrl(href) {
  try {
    const u = new URL(href, "https://www.bing.com");
    const uParam = u.searchParams.get("u");
    if (uParam && uParam.startsWith("a1")) {
      let b = uParam.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      const dec = Buffer.from(b, "base64").toString("utf8");
      const m = dec.match(/https?:\/\/\S+/);
      if (m) return m[0];
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 实时检索：纯片名查询 Bing，返回真实结果（含可能的 magnet）。 */
async function tryLiveFetch(name) {
  const url = `https://www.bing.com/search?q=${enc(name)}&setlang=zh-CN&cc=CN`;
  const html = await fetchText(url, 8000);
  if (!html) return { items: [], magnets: [] };
  return parseBingResults(html, name);
}

/** 构造分层检索入口（始终返回，作为实时结果的补充）。 */
function buildEntryGroups(query) {
  const kbItems = KB_SITES.map((s) => ({
    title: s.name, url: s.base + enc(query), rating: "良好", meta: s.desc, flags: [], source: s.name,
  }));
  const engineItems = SEARCH_ENGINES.map((e) => ({
    title: `${e.name} · 综合精准检索`,
    url: e.base + enc(query + (e.suffix || "")),
    rating: "良好",
    meta: "通用搜索引擎，已预填「名称 + 磁力/种子/4K/BT」关键词。",
    flags: [],
    source: e.name,
  }));
  const magnetItems = MAGNET_SITES.map((s) => ({
    title: s.name, url: s.base + enc(query), rating: "一般",
    meta: "磁力 / BT 聚合索引，点击在新标签检索；聚合站若需登录才能显示完整链接，请按站点要求操作。",
    flags: ["需验证"], source: s.name,
  }));
  const cloudItems = CLOUD_SITES.map((s) => ({
    title: s.name, url: s.base + enc(query + (s.suffix || "")), rating: "一般",
    meta: "网盘 / 云资源检索入口，建议优先核对提取码与文件完整性。",
    flags: ["需验证"], source: s.name,
  }));
  return [
    { kind: "kb", title: "阶段零 · 知识库直连", note: "已知专业资源站点，直达检索（优先于通用搜索）。", items: kbItems },
    { kind: "engine", title: "阶段一 · 通用搜索引擎", note: "已预填精准关键词，点击可在新标签查看结果。", items: engineItems },
    { kind: "magnet", title: "阶段三 · 磁力 / BT 聚合", note: "磁力链接聚合索引，结果需自行核对做种与完整性。", items: magnetItems },
    { kind: "cloud", title: "阶段三 · 网盘 / 云资源", note: "云盘资源检索入口。", items: cloudItems },
  ];
}

function buildResult(query, { items, magnets }) {
  const groups = buildEntryGroups(query);
  const liveItems = [...items, ...magnets];
  if (liveItems.length) {
    groups.unshift({
      kind: "live",
      title: "实时检索结果 · Bing",
      note: "以下为真实网页检索命中（标题 / 直链 / 摘要），点击直达；做种与完整性以站点为准。",
      items: liveItems,
    });
  }
  return {
    query,
    keyword: "影视搜索",
    summary: liveItems.length
      ? `已为「${query}」实时检索到 ${liveItems.length} 条真实网页结果，并附分层检索入口。`
      : `已为「${query}」生成分层检索入口：知识库直连 + 通用搜索 + 磁力/网盘聚合。`,
    generatedAt: new Date().toISOString(),
    groups,
    tips: [
      "优先选择做种数 > 0 的资源，下载更快更完整。",
      "资源到手后请核对分辨率、语言、集数是否匹配需求。",
      "系统仅提供检索入口与已抓取的公开链接，绝不自动开始下载。",
    ],
    warnings: [
      "聚合站页面若需登录才能看到完整链接，请直接按站点提示操作，勿反复抓取。",
      "未经验证的资源（做种为 0 / 缺分辨率）可能难以下载或信息不全。",
    ],
    live: liveItems.length > 0,
  };
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readQuery(req) {
  try {
    const url = new URL(req.url, "http://localhost");
    return (url.searchParams.get("q") || "").trim();
  } catch (e) {
    return "";
  }
}

async function handleSearch(req, res) {
  const q = readQuery(req);
  if (!q) return sendJSON(res, 400, { error: "缺少查询参数 q（影视名称）" });
  log("检索：", q);
  let live = { items: [], magnets: [] };
  try {
    live = await tryLiveFetch(q);
  } catch (e) {
    warn("实时检索异常（已忽略，回退入口）：", e.message);
  }
  sendJSON(res, 200, buildResult(q, live));
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/moviesearch") {
        return await handleSearch(req, res);
      }
      if (req.method === "GET" && url.pathname === "/api/moviesearch/health") {
        return sendJSON(res, 200, { ok: true, service: "movie-search", ts: new Date().toISOString() });
      }
      sendJSON(res, 404, { error: "未找到接口：" + url.pathname });
    } catch (e) {
      warn("请求处理异常：", e.message);
      sendJSON(res, 500, { error: e.message });
    }
  });
}

const server = createServer();
server.listen(PORT, () => {
  log("影视搜索代理已启动： http://localhost:" + PORT);
  log("浏览器经 Vite 同源代理 /api/moviesearch 访问；本进程执行真实 Bing 检索。");
});

const shutdown = () => {
  log("正在关闭…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
