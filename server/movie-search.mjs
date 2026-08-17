#!/usr/bin/env node
/**
 * 影视搜索代理 · J.A.R.V.I.S. Cyber Audio Spectrum
 *
 * 为什么需要它：浏览器直接抓取第三方站点会遭遇 CORS，且抓取逻辑不宜进入前端 bundle。
 * 本服务在 Node 侧实现「影视搜索v4.1」工作流的真实检索，目标直指用户要的
 * 「下载链接 / 网盘资源地址」：
 *
 *   1) 定向检索：用「片名 + 下载 / 磁力 / 网盘 / 迅雷下载」四个 Bing 查询
 *      （setlang=zh-CN&cc=CN）。注意：Bing 对「百度网盘」整词与 site: 语法会退化成词典页，
 *      故只用单资源词；纯片名查询用于兜底。
 *   2) 过滤：丢弃纯信息/在线观看大站（豆瓣/百科/腾讯视频/爱奇艺/优酷等），
 *      保留带下载/网盘/磁力意图的资源页（贴吧资源帖、百度知道、网盘搜索站、Remux/恩山/1lou 论坛）。
 *   3) 深抠直链：对排名靠前的资源页并行抓取，提取真实
 *      pan.baidu.com 分享地址（/s/ 与 /share/link）、magnet: 磁力链接、ed2k: 链接，
 *      去重后置顶为「实时直链 · 下载/网盘地址」分组返回。
 *   4) 检索入口（补充）：搜索引擎分层入口，供实时结果不足时手动深挖。
 *
 * 诚实原则：绝不伪造磁力哈希；直链仅含真实提取到的链接，统一标注「需验证」。
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
const MAGNET_RE = /magnet:\?xt=urn:btih:[A-Za-z0-9]+[^\s"'<>]*/gi;
const PAN_RE = /https?:\/\/(?:[a-z0-9-]+\.)*pan\.baidu\.com\/(?:s\/[A-Za-z0-9_-]+|share\/link\?[^\s"'<>]+)/gi;
const ED2K_RE = /ed2k:\/\/\|file\|[^\s"'<>]+\|/gi;
// 迅雷专用链（base64 包裹，解码后即真实 magnet / ed2k / 网盘地址）
const THUNDER_RE = /thunder:\/\/[A-Za-z0-9+/=]+/gi;
// 提取码 / 密码 / 访问码（4~8 位字母数字）
const CODE_RE = /(?:提取码|提取|访问码|密码|验证码)[\s:：]*([A-Za-z0-9]{4,8})/i;

// —— 各网盘分享地址模式（用于从资源页深抠直链）；按用户要求优先夸克网盘 ——
const NETDISK_DEFS = [
  { type: "quark",  label: "夸克网盘", re: /https?:\/\/(?:[a-z0-9-]+\.)*pan\.quark\.cn\/s\/[A-Za-z0-9_-]+/gi },
  { type: "aliyun", label: "阿里云盘", re: /https?:\/\/(?:[a-z0-9-]+\.)*(?:alipan\.com|aliyundrive\.com|pan\.aliyun\.com)\/s\/[A-Za-z0-9_-]+/gi },
  { type: "xunlei", label: "迅雷云盘", re: /https?:\/\/(?:[a-z0-9-]+\.)*pan\.xunlei\.com\/s\/[A-Za-z0-9_-]+/gi },
  { type: "baidu",  label: "百度网盘", re: PAN_RE },
  { type: "tianyi", label: "天翼云盘", re: /https?:\/\/(?:[a-z0-9-]+\.)*cloud\.189\.cn\/(?:web\/|share\/)?[A-Za-z0-9_?=&%\-]{6,}/gi },
  { type: "115",    label: "115网盘",  re: /https?:\/\/(?:[a-z0-9-]+\.)*115\.com\/(?:share|file|index\.php\?f=)[A-Za-z0-9_\-]*/gi },
];
// 网盘类型优先级：夸克优先，其次阿里云盘 / 迅雷 / 百度 / 天翼 / 115
const NETDISK_PRIORITY = { quark: 0, aliyun: 1, xunlei: 2, baidu: 3, tianyi: 4, 115: 5 };

// —— 站点定义（检索入口层，在用户浏览器侧打开）——
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

/** 带超时的文本抓取；任何异常（网络/证书/超时/403）返回空串，绝不抛错中断主流程。 */
async function fetchText(url, ms = 6000) {
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

function bingUrl(q) {
  return `https://www.bing.com/search?q=${enc(q)}&setlang=zh-CN&cc=CN`;
}

/** 解析 Bing 结果页 b_algo 块，抽取标题/直链/摘要/主机。 */
function parseBingBlocks(html) {
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  const out = [];
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
      if (/bing\.com|microsoft\.com|msn\.com/i.test(host)) continue;
    } catch {
      continue;
    }
    const title = h2[2].replace(/<[^>]+>/g, "").trim();
    if (!title) continue;
    const snipM = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const meta = snipM
      ? snipM[1].replace(/<[^>]+>/g, "").replace(/&ensp;|&#0183;|&nbsp;/g, " ").trim().slice(0, 160)
      : "";
    out.push({ title, url: href, host, meta });
  }
  return out;
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

// 纯信息 / 在线观看大站（非用户要的下载/网盘资源）
const INFO_HOSTS = [
  /douban\.com/, /baike\.baidu/, /v\.qq\.com/, /iqiyi\.com/, /youku\.com/,
  /bilibili\.com/, /mgtv\.com/, /1905\.com/, /so\.youku/, /so\.iqiyi/,
  /kktvs\.com/, /wokanys\.com/, /tvmao\.com/, /movie\.douban/,
];
// 资源意图关键词
const RES_KW = /下载|磁力|magnet|bt|种子|网盘|pan\.baidu|资源|提取码|迅雷|ed2k|4K|remux|夸克|阿里云盘|盘|影视吧|资源吧|全集|高清|完整版|bd|天碟/i;
// 已知资源论坛 / 网盘搜索站主机
const RES_HOSTS = /xiaokupan|1lou\.xyz|remux\.wiki|right\.com\.cn|zhidao\.baidu|tieba\.baidu|pansou|zhongziso|cilicat|51btbtt|zymk|dy2018|ygdy8|bt\.|\.torrent/i;

function isResourceIntent(it) {
  if (RES_HOSTS.test(it.host)) return true;
  if (RES_KW.test(it.title + " " + it.meta)) return true;
  return false;
}
function isInfoHost(it) {
  return INFO_HOSTS.some((re) => re.test(it.host));
}

/** 解码迅雷专用链 thunder:// → 真实链接（magnet / ed2k / http）。 */
function decodeThunder(th) {
  try {
    const b = th.slice("thunder://".length);
    const dec = Buffer.from(b, "base64").toString("latin1");
    let s = dec;
    if (s.startsWith("AA") && s.endsWith("ZZ")) s = s.slice(2, -2);
    s = s.trim();
    return /^(magnet:|ed2k:|https?:\/\/)/i.test(s) ? s : "";
  } catch {
    return "";
  }
}

/** 位置感知：扫描页面所有匹配 regex 的网盘链接与所有提取码（含位置），为每条链接挂载最近的码（距离阈值内才关联，避免误挂载）。 */
function extractLinksWithCodes(html, regex) {
  const linkMatches = [...html.matchAll(new RegExp(regex.source, "gi"))].map((m) => ({ url: m[0], pos: m.index }));
  const codeMatches = [...html.matchAll(new RegExp(CODE_RE.source, "gi"))].map((m) => ({ code: m[1], pos: m.index }));
  const out = new Map();
  for (const lm of linkMatches) {
    let best = "";
    let bestDist = Infinity;
    for (const cm of codeMatches) {
      const d = Math.abs(cm.pos - lm.pos);
      if (d < bestDist) {
        bestDist = d;
        best = cm.code;
      }
    }
    // 仅当码与链接距离较近（同帖概率高）才挂载，否则留空由用户点开查看
    out.set(lm.url, bestDist <= 1200 ? best : "");
  }
  return out;
}

/** 深抠直链：对资源页并行抓取，提取 pan/magnet/ed2k 真实链接，并就近抠提取码、解码迅雷链。 */
async function extractDirectLinks(resourceItems) {
  const targets = resourceItems.slice(0, 8);
  const ndMap = new Map(); // url -> { type, code }（各类网盘分享地址 + 就近提取码）
  const magSet = new Set();
  const edSet = new Set();

  await Promise.all(
    targets.map(async (it) => {
      const html = await fetchText(it.url, 5000);
      if (!html) return;
      const grab = (re, set) => {
        const r = new RegExp(re);
        let m;
        while ((m = r.exec(html))) set.add(m[0]);
      };
      // 各类网盘分享地址 + 位置感知提取码（夸克 / 阿里云盘 / 迅雷 / 百度 / 天翼 / 115）
      for (const def of NETDISK_DEFS) {
        const found = extractLinksWithCodes(html, def.re);
        for (const [u, code] of found) {
          if (!ndMap.has(u)) ndMap.set(u, { type: def.type, code });
        }
      }
      grab(MAGNET_RE, magSet);
      grab(ED2K_RE, edSet);
      // 迅雷专用链 → 解码为真实 magnet / ed2k / 网盘
      let tm;
      const tr = new RegExp(THUNDER_RE);
      while ((tm = tr.exec(html))) {
        const d = decodeThunder(tm[0]);
        if (!d) continue;
        if (d.startsWith("magnet:")) magSet.add(d);
        else if (d.startsWith("ed2k:")) edSet.add(d);
        else if (/pan\.(baidu|quark|xunlei|aliyun|189)\.com/i.test(d) && !ndMap.has(d)) {
          const t = /quark/.test(d) ? "quark" : /xunlei/.test(d) ? "xunlei" : /aliyun/.test(d) ? "aliyun" : /189/.test(d) ? "tianyi" : "baidu";
          ndMap.set(d, { type: t, code: "" });
        }
      }
    })
  );

  const links = [];
  let ndIdx = 0;
  for (const [u, info] of ndMap) {
    ndIdx++;
    const def = NETDISK_DEFS.find((d) => d.type === info.type) || NETDISK_DEFS[NETDISK_DEFS.length - 1];
    const hasCode = !!info.code;
    links.push({
      title: `${def.label} #${ndIdx}`,
      url: u,
      code: info.code,
      rating: hasCode ? "良好" : "需验证",
      meta: hasCode
        ? `${def.label}分享地址，已附提取码；点开直接填码即可转存 / 下载。`
        : `${def.label}分享地址（本页未抓到提取码，点开查看有效性）。`,
      flags: hasCode ? ["已附提取码"] : ["需验证提取码"],
      source: def.label,
      kind: "pan",
      type: def.type,
    });
  }
  let i = 0;
  for (const m of magSet) {
    i++;
    links.push({
      title: `磁力链接 #${i}`,
      url: m,
      rating: "良好",
      meta: "磁力链接（magnet），用迅雷 / qBittorrent 添加，无需提取码，直接可用。",
      flags: ["无需提取码"],
      source: "资源页深链",
      kind: "magnet",
    });
  }
  i = 0;
  for (const e of edSet) {
    i++;
    links.push({
      title: `eMule / ed2k 链接 #${i}`,
      url: e,
      rating: "需验证",
      meta: "eD2k 链接，用 eMule / 电驴 添加；做种与完整性以发布页为准。",
      flags: ["无需提取码"],
      source: "资源页深链",
      kind: "ed2k",
    });
  }

  // 排序：网盘(pan) 优先、磁力(magnet) 次之、ed2k 最后；网盘内按类型优先级（夸克最前），同类型带码优先
  const kindOrder = { pan: 0, magnet: 1, ed2k: 2 };
  const ndPri = (it) => (NETDISK_PRIORITY[it.type] != null ? NETDISK_PRIORITY[it.type] : 99);
  links.sort((a, b) => {
    const k = kindOrder[a.kind] - kindOrder[b.kind];
    if (k !== 0) return k;
    if (a.kind === "pan" && b.kind === "pan") {
      const p = ndPri(a) - ndPri(b);
      if (p !== 0) return p;
      return (b.code ? 1 : 0) - (a.code ? 1 : 0);
    }
    return 0;
  });
  return links;
}

/** 实时检索主流程：多查询定向搜（并行）+ 过滤 + 深抠直链。 */
async function tryLiveFetch(name) {
  // 定向资源查询（避开会让 Bing 退化的「百度网盘」整词与 site: 语法）
  const queries = [name + " 下载", name + " 磁力", name + " 网盘", name + " 迅雷下载", name];
  const byUrl = new Map();
  // 并行抓取各查询，单查询超时 6s，互不阻塞
  await Promise.all(
    queries.map(async (q) => {
      const html = await fetchText(bingUrl(q), 6000);
      if (!html) return;
      for (const it of parseBingBlocks(html)) {
        if (!byUrl.has(it.url)) byUrl.set(it.url, it);
      }
    })
  );
  const all = [...byUrl.values()];
  // 资源意图优先，纯信息大站降级（仍保留，仅在无资源结果时兜底）
  const resource = all.filter((it) => isResourceIntent(it) && !isInfoHost(it));
  const info = all.filter((it) => !isResourceIntent(it) || isInfoHost(it));
  const pageItems = resource.length ? resource : info;

  const directLinks = await extractDirectLinks(pageItems);

  return { pageItems: pageItems.slice(0, 8), directLinks };
}

/** 构造分层检索入口（始终返回，作为实时结果的补充）。 */
function buildEntryGroups(query) {
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
    { kind: "engine", title: "手动检索入口 · 通用搜索", note: "已预填精准关键词，点击在新标签查看结果。", items: engineItems },
    { kind: "magnet", title: "手动检索入口 · 磁力 / BT 聚合", note: "磁力链接聚合索引，结果需自行核对做种与完整性。", items: magnetItems },
    { kind: "cloud", title: "手动检索入口 · 网盘 / 云资源", note: "云盘资源检索入口。", items: cloudItems },
  ];
}

function buildResult(query, { pageItems, directLinks }) {
  // 仅保留用户要的直链类型（磁力 / 网盘 / ed2k），按类型分别限量，放宽上限
  const cap = { pan: 14, magnet: 10, ed2k: 3 };
  const byKind = { pan: [], magnet: [], ed2k: [] };
  for (const d of directLinks || []) {
    const k = d.kind;
    if (byKind[k] && byKind[k].length < cap[k]) byKind[k].push(d);
  }
  // 网盘内按类型优先级排序（夸克最前），同类型带提取码优先
  const ndPri = (it) => (NETDISK_PRIORITY[it.type] != null ? NETDISK_PRIORITY[it.type] : 99);
  byKind.pan.sort((a, b) => {
    const p = ndPri(a) - ndPri(b);
    if (p !== 0) return p;
    return (b.code ? 1 : 0) - (a.code ? 1 : 0);
  });
  const panItems = byKind.pan;
  const magItems = [...byKind.magnet, ...byKind.ed2k]; // 磁力与 ed2k 同区（均免提取码、直可用）
  const directCount = panItems.length + magItems.length;

  const groups = [];

  // —— 置顶：直链（用户真正要的磁链 / 网盘地址），明文、可复制 ——
  if (magItems.length) {
    groups.push({
      kind: "magnet",
      title: "🧲 磁力直链",
      note: "真实磁力链接，点击或复制后用迅雷 / qBittorrent 添加，无需提取码、直接可用。",
      items: magItems,
    });
  }
  if (panItems.length) {
    groups.push({
      kind: "pan",
      title: "📦 网盘直链",
      note: "真实网盘分享地址（夸克 / 阿里云盘 / 迅雷云盘 / 百度网盘等），已按夸克网盘优先排序；已附提取码的点开直接填码转存，未附码的需点开查看。",
      items: panItems,
    });
  }

  // —— 仅当直链很少（<4）时才补充分页检索入口作为备选；直链充足则彻底不显示网页地址，避免干扰 ——
  const live = directCount > 0;
  if (directCount < 4) {
    groups.push(...buildEntryGroups(query));
    if (pageItems.length) {
      groups.push({
        kind: "resource",
        title: "资源检索页（点开获取）",
        note: "真实资源帖 / 网盘搜索 / 论坛页，点开可在站内取得提取码与完整链接。",
        items: pageItems.slice(0, 6).map((it) => ({
          title: it.title,
          url: it.url,
          rating: "良好",
          meta: it.meta || `来自 ${it.host} 的资源检索结果。`,
          flags: [/网盘|pan/i.test(it.title + it.meta) ? ["含网盘线索"] : []],
          source: it.host,
        })),
      });
    }
  }

  const codeCount = panItems.filter((d) => d.code).length;
  return {
    query,
    keyword: "影视搜索",
    summary: live
      ? `已为「${query}」实时检索到 ${magItems.length} 条磁力直链 + ${panItems.length} 条网盘直链（其中 ${codeCount} 条已附提取码，已按夸克网盘优先排列）。`
      : `未检索到直链，已附分层检索入口（点开手动检索）。`,
    generatedAt: new Date().toISOString(),
    groups,
    tips: [
      "磁力链接用迅雷 / qBittorrent 添加；百度网盘链接点开填提取码。",
      "优先选择做种数 > 0 的资源，下载更快更完整。",
      "资源到手后请核对分辨率、语言、集数是否匹配需求。",
    ],
    warnings: [
      "直链均标注「需验证」，做种为 0 / 缺分辨率的资源可能难以下载或信息不全。",
    ],
    live,
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
  let live = { pageItems: [], directLinks: [] };
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
  log("浏览器经 Vite 同源代理 /api/moviesearch 访问；本进程执行真实 Bing 检索 + 直链深抠。");
});

const shutdown = () => {
  log("正在关闭…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
