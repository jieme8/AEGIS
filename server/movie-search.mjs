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
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOVIE_SEARCH_PORT) || 8789;

// —— 别名/译名消歧表（P0-1：查询规范化）——
let ALIASES = [];
try {
  ALIASES = JSON.parse(readFileSync(path.join(__dirname, "alias-map.json"), "utf8")).aliases || [];
} catch (e) {
  warn("别名表加载失败（仅影响查询规范化）：", e.message);
  ALIASES = [];
}

// —— UA 池：轮换 User-Agent，降低单 UA 被封概率（P2-6）——
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
];
let _uaIdx = 0;
function pickUA() {
  const ua = UA_POOL[_uaIdx % UA_POOL.length];
  _uaIdx++;
  return ua;
}

const log = (...a) => console.log("[movie-search]", ...a);
const warn = (...a) => console.warn("[movie-search]", ...a);

// —— P2-6 结果缓存：同查询 5 分钟，降低重复抓取与 Bing 封禁概率 ——
const RESULT_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;
function cacheGet(q) {
  const hit = RESULT_CACHE.get(q);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.result;
  RESULT_CACHE.delete(q);
  return null;
}
function cacheSet(q, result) {
  if (RESULT_CACHE.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of RESULT_CACHE) if (now - v.ts > CACHE_TTL) RESULT_CACHE.delete(k);
  }
  RESULT_CACHE.set(q, { ts: Date.now(), result });
}

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

// 搜索结果摘要/链接中直接出现的网盘分享地址（供中文搜索引擎信源直链注入）
const WEBPAN_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:pan\.baidu\.com\/s\/|share\.lanzou[^.\s]*?\.com\/|pan\.quark\.cn\/s\/|alipan\.com\/s\/|aliyundrive\.com\/s\/|pan\.xunlei\.com\/s\/|cloud\.189\.cn\/(?:web\/|share\/)|115\.com\/)[^\s"'<>，。；()]+/gi;

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

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

/** 带超时的文本抓取（UA 池轮换）；任何异常（网络/证书/超时/403）返回空串，绝不抛错中断主流程。 */
async function fetchText(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": pickUA(),
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

/** 带失败状态区分的抓取（供新 source 层用；正常源返回 {ok,text}，异常返回 {ok:false, reason}）。 */
async function fetchTextMeta(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": pickUA(),
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
    });
    if (!r.ok) return { ok: false, text: "", reason: `HTTP ${r.status}` };
    return { ok: true, text: await r.text(), reason: "" };
  } catch (e) {
    return { ok: false, text: "", reason: e.name === "AbortError" ? "超时" : "网络错误" };
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
  /zhihu\.com/, /wikipedia\.org/, /baike\.so\.com/, /hudong\.com/,
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
  const targets = resourceItems.slice(0, 12);
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

// —— 并发受限执行器（抓取/请求统一限流，防止单 UA 瞬时轰炸被封）——
async function runConcurrent(tasks, conc) {
  let i = 0;
  const n = Math.min(conc, Math.max(tasks.length, 1));
  const worker = async () => {
    while (i < tasks.length) {
      const fn = tasks[i++];
      await fn();
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/** 归一化：小写、去空白与标点，保留 CJK 与字母数字（与 movie-meta 侧一致）。 */
function normalize(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * 相关性门控（核心质量护栏）：结果标题/摘要必须命中查询词。
 * 命中规则：整体包含 或 命中查询词的任意 ≥3 字连续子串（容错缩写/分词），
 * 否则判为无关（如「盗梦空间」被拆词后返回的九九乘法表）直接丢弃。
 */
function isRelevantSat(it, q) {
  const qn = normalize(q);
  if (!qn) return true;
  const blob = normalize((it.title || "") + " " + (it.meta || ""));
  if (!blob) return false;
  if (blob.includes(qn)) return true;
  if (qn.length >= 4) {
    for (let i = 0; i + 3 <= qn.length; i++) {
      const sub = qn.slice(i, i + 3);
      if (sub.length >= 3 && blob.includes(sub)) return true;
    }
  }
  return false;
}

/** 稳定查询包装：含空格的连续词加引号，强制 Bing 完整匹配（防拆词噪声）。 */
function qq(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t) return "";
  if (/["]/.test(t)) return t;
  return `"${t}"`;
}

/**
 * P0-1 查询规范化：别名/译名消歧 + 年份透传 + 英文原文。
 * 「泰坦尼克号」→ { name:"泰坦尼克号", en:"Titanic", year:"" }；
 * 「铁达尼号 1997」→ { name:"泰坦尼克号 1997", en:"Titanic", year:"1997" }。
 */
export function normalizeMovieQuery(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const ym = s.match(/\b(19|20)\d{2}\b/);
  const year = ym ? ym[0] : "";
  const qn = normalize(s);
  const cands = [];
  for (const e of ALIASES) {
    for (const a of [e.m, ...(e.aliases || [])]) {
      const an = normalize(a || "");
      if (!an) continue;
      if (qn === an || (qn.includes(an) && an.length >= 2)) cands.push({ e, an });
    }
  }
  cands.sort((x, y) => y.an.length - x.an.length); // 最长别名优先（最精确）
  const chosen = cands[0] ? cands[0].e : null;
  let name = s;
  if (chosen) {
    let replaced = false;
    for (const a of [chosen.m, ...(chosen.aliases || [])]) {
      if (a && s.includes(a)) { name = s.replace(a, chosen.m); replaced = true; break; }
    }
    if (!replaced) name = chosen.m;
    // 若输入与别名完全一致（如「Titanic zh」已含附加词），保留附加词
    if (normalize(name) === qn && qn !== normalize(chosen.m) && !s.includes(chosen.m)) {
      name = year ? `${chosen.m} ${year}` : chosen.m;
    }
  }
  return { name: name.trim(), year, canon: chosen ? chosen.m : "", en: chosen ? chosen.en : "" };
}

/**
 * P0-1 多查询矩阵：在保留原有 5 个定向查询的基础上，追加别名主名、年份限定、
 * 英文原文（magnet/1080p 双通道），去重后最多 6 组，覆盖更广的帖子措辞。
 */
export function buildQueries(q) {
  const { name, year, en } = normalizeMovieQuery(q);
  const set = [];
  const add = (x) => { const v = (x || "").trim(); if (v && !set.includes(v)) set.push(v); };
  const hasYear = year && name.includes(year);
  add(qq(name));
  add(`${qq(name)} 下载`);
  add(`${qq(name)} 磁力`);
  add(`${qq(name)} 网盘`);
  add(`${qq(name)} 迅雷 种子`);
  if (year && !hasYear) {
    add(`${qq(name)} ${year}`);
    add(`${qq(name)} ${year} 4K`);
  }
  if (en) {
    add(`${qq(en)} torrent magnet download`);
    add(`${qq(en)} ${year || ""} 1080p`.replace(/\s+/g, " ").trim());
  }
  return set.slice(0, 6);
}

// —— P0-2 磁力索引源直查（server 侧主动抓取，产出带做种/大小的真实磁力）——
// 每个源实现 build(url) 与 parse(html, q)。结构变化/反爬 → parse 返回 []，静默回退。
function parseTorrentKitty(html) {
  const items = [];
  const blocks = html.split(/<li class="result"/i).slice(1);
  if (!blocks.length) return items;
  for (const b of blocks) {
    const am = b.match(/<a[^>]*href="(magnet:[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    const url = am[1].trim();
    if (!url.startsWith("magnet:?xt=urn:btih:")) continue;
    const title = am[2].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
    if (!title) continue;
    const sizeM = b.match(/<td[^>]*class="size"[^>]*>([^<]+)</i) || b.match(/Size[\s\S]{0,40}<td[^>]*>([^<]{2,24})</i);
    const size = sizeM ? sizeM[1].trim() : "";
    items.push({ title, url, size, seeders: 0 });
  }
  return items;
}

function parseBt4g(html) {
  const items = [];
  const blocks = html.split(/<div class="result"/i).slice(1);
  if (!blocks.length) return items;
  for (const b of blocks) {
    const titleM = b.match(/<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleM ? titleM[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ") : "";
    const hashM = b.match(/\/(?:magnet|view-magnet|download)\/([A-Fa-f0-9]{40})/i) || b.match(/\b([A-Fa-f0-9]{40})\b/);
    if (!title && !hashM) continue;
    const hash = (hashM && hashM[1]) || "";
    if (!hash) continue;
    // 由页面真实 btih 哈希封装标准 magnet（哈希来自站点，非伪造）
    const url = `magnet:?xt=urn:btih:${hash.toLowerCase()}&dn=${encodeURIComponent(title)}`;
    const seedM = b.match(/Seeds?:?\s*(\d+)/i) || b.match(/(\d+)\s+Seeder/i);
    const seeders = seedM ? Number(seedM[1]) || 0 : 0;
    const sizeM = b.match(/Size:?\s*([\d.]+ ?[KMGTP]?i?B)/i) || b.match(/([\d.]+ ?[KMGTP]?i?B)/i);
    const size = sizeM ? sizeM[1].trim() : "";
    items.push({ title: title || `BT4G 资源`, url, size, seeders });
  }
  return items;
}

// —— P0-2 站点定义 ——
const INDEX_SOURCES = [
  { key: "torrentkitty", name: "TorrentKitty", build: (q) => `https://www.torrentkitty.tv/search/${enc(q)}/`, parse: parseTorrentKitty },
  { key: "bt4g", name: "BT4G", build: (q) => `https://bt4gprx.com/search?q=${enc(q)}`, parse: parseBt4g },
];

/** 360 搜索（so.com）结果解析：中文资源帖/网盘帖收录好，href 为真实地址。从整块抠网盘链 + 就近提取码。 */
function parseSo360(html) {
  const out = [];
  const blocks = html.split(/<li class="res-list"/i).slice(1);
  for (const b of blocks) {
    const am = b.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    let url = am[1];
    if (/^\/\//i.test(url)) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) continue;
    const title = am[2].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
    if (!title) continue;
    const snip = b.match(/<p[^>]*class="res-desc"[^>]*>([\s\S]*?)<\/p>/i) || b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const meta = snip ? snip[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ").slice(0, 160) : "";
    // 从整块（而非 160 字摘要）抠网盘分享链接，并就近关联提取码
    const panLinks = extractPanWithCodes(b);
    // href 本身就是网盘分享链接（360 部分结果直达盘页）
    const panHrefs = [];
    const hm = url.match(WEBPAN_RE);
    if (hm) panHrefs.push({ url: hm[0], code: "" });
    out.push({ title, url, host: safeHost(url), meta, panLinks, panHrefs });
  }
  return out;
}

/** 搜狗结果解析：中文网盘/磁力关键词命中率高；href 常为 /link?url= 重定向，正文仍可抠网盘地址。 */
function parseSogou(html) {
  const out = [];
  const blocks = html.split(/<div class="vrwrap"/i).slice(1);
  for (const b of blocks) {
    const am = b.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    let url = am[1];
    if (url.startsWith("/link?url=")) url = "https://www.sogou.com" + url;
    if (/^\/\//i.test(url)) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) continue;
    const title = am[2].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
    if (!title) continue;
    const snip = b.match(/<div class="[^"]*(?:text-layout|space-txt|str_info)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || b.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const meta = snip ? snip[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ").slice(0, 160) : "";
    const panLinks = extractPanWithCodes(b);
    const panHrefs = [];
    const hm = url.match(WEBPAN_RE);
    if (hm) panHrefs.push({ url: hm[0], code: "" });
    out.push({ title, url, host: safeHost(url), meta, panLinks, panHrefs });
  }
  return out;
}

/** 在整块 HTML 中抠所有网盘分享链接，并为每条就近挂载提取码（±260 字符窗口）。 */
function extractPanWithCodes(block) {
  const links = [];
  for (const lm of block.matchAll(WEBPAN_RE)) {
    const url = String(lm[0]).replace(/[),。；，\s'\"]+$/g, "");
    if (!/^https?:\/\//i.test(url)) continue;
    const local = block.slice(Math.max(0, lm.index - 260), lm.index + 80);
    const cm = local.match(CODE_RE);
    links.push({ url, code: cm ? cm[1] : "" });
  }
  return links;
}

const WEB_SOURCES = [
  { key: "so360", name: "360搜索", build: (q) => `https://www.so.com/s?q=${enc(q + " 网盘 资源 下载")}`, parse: parseSo360 },
  { key: "sogou", name: "搜狗", build: (q) => `https://www.sogou.com/web?query=${enc(q + " 网盘 资源 下载")}`, parse: parseSogou },
];

// Bing 网盘定向查询（P0-2：用站名而非「百度网盘」整词，规避词典页退化）
const PAN_TARGETS = [
  { kw: "夸克网盘 分享" },
  { kw: "阿里云盘 资源" },
  { kw: "迅雷云盘 分享" },
  { kw: "百度网盘 提取码" },
  { kw: "贴吧 资源" },
];

/**
 * P0-2 多源检索：磁力索引站直查（TorrentKitty / BT4G）+ Bing 网盘定向 + 360/搜狗中文资源搜索。
 * @returns {{torrents:Array, pages:Array, pans:Array}} torrents=索引站磁力；
 *   pages=资源线索页（供深抠）；pans=搜索结果摘要中直接暴露的网盘分享（直链注入）
 */
async function searchSiteSources(q) {
  const out = { torrents: [], pages: [], pans: [] };
  // 1) 磁力索引站直查：标题同一性初筛（差集过大会放进池子影响质量）
  await runConcurrent(
    INDEX_SOURCES.map((src) => async () => {
      const { ok, text } = await fetchTextMeta(src.build(q), 6500);
      if (!ok || !text) return;
      try {
        const qn = normalize(q);
        for (const it of src.parse(text)) {
          const tn = normalize(it.title);
          if (tn && qn && tn.length >= 2 && !tn.includes(qn) && !qn.includes(tn)) continue;
          out.torrents.push({ ...it, srcKey: src.key, srcName: src.name });
        }
      } catch { /* 解析异常静默回退 */ }
    }),
    2
  );
  // 去重（同磁力 hash 只留第一条，优先带做种）
  const byHash = new Map();
  for (const t of out.torrents) {
    const h = (t.url.match(/:btih:([^&]+)/i) || [])[1];
    const key = h || t.url;
    const cur = byHash.get(key);
    if (!cur) byHash.set(key, t);
    else if (t.seeders > cur.seeders) byHash.set(key, t);
  }
  out.torrents = [...byHash.values()];

  // 2) 网盘定向（site 词不强制，避免退化；仅取资源意图 + 相关性命中页）
  await runConcurrent(
    PAN_TARGETS.map((p) => async () => {
      const query = `${qq(q)} ${p.kw}`;
      const html = await fetchText(bingUrl(query), 6000);
      if (!html) return;
      for (const it of parseBingBlocks(html)) {
        if (isInfoHost(it)) continue;
        if (isResourceIntent(it) && isRelevantSat(it, q)) out.pages.push({ ...it, srcKey: "bing-pan", srcName: p.kw });
      }
    }),
    3
  );

  // 3) 360 / 搜狗 中文资源搜索（正文暴露的网盘直链+提取码直接注入，其余入深抠池）
  await runConcurrent(
    WEB_SOURCES.map((w) => async () => {
      const { ok, text } = await fetchTextMeta(w.build(q), 7000);
      if (!ok || !text) return;
      try {
        for (const it of w.parse(text)) {
          if (!isRelevantSat(it, q)) continue;
          for (const pl of it.panLinks || []) {
            if (pl.url) out.pans.push({ title: it.title, url: pl.url, code: pl.code || "", hostIntent: w.name, hitTitle: it.title });
          }
          for (const pl of it.panHrefs || []) {
            if (pl.url) out.pans.push({ title: it.title, url: pl.url, code: pl.code || "", hostIntent: w.name, hitTitle: it.title });
          }
          out.pages.push({ ...it, srcKey: w.key, srcName: w.name });
          if (out.pages.length > 14) break;
        }
      } catch { /* 解析异常静默 */ }
    }),
    2
  );
  return out;
}

/** Bing 定向检索（P0-1 查询矩阵 + 并发限流）：返回资源页列表与命中数。 */
async function searchBing(name) {
  const queries = buildQueries(name);
  const byUrl = new Map();
  await runConcurrent(
    queries.map((q) => async () => {
      const html = await fetchText(bingUrl(q), 6000);
      if (!html) return;
      for (const it of parseBingBlocks(html)) {
        if (!byUrl.has(it.url)) byUrl.set(it.url, it);
      }
    }),
    3
  );
  const all = [...byUrl.values()];
  // 资源意图优先：相关性门控（防拆词垃圾）+ 资源意图 + 非信息大站；同类降级兜底
  const relevant = all.filter((it) => isRelevantSat(it, name));
  const resource = relevant.filter((it) => isResourceIntent(it) && !isInfoHost(it));
  const info = relevant.filter((it) => !isResourceIntent(it) || isInfoHost(it));
  const pageItems = (resource.length ? resource : info).slice(0, 8);
  return { pageItems, bingHit: all.length };
}

// —— 网盘失效 / 过期页面标记（服务端直出失效页时命中；SPA 壳页会回退为 unknown）——
const EXPIRED_RE = /已失效|链接已过期|分享已取消|分享不存在|文件已被删除|此分享已失效|访问已过期|该分享已失效|分享内容已经被取消|页面不存在|该链接分享内容可能已经删除|分享已失效|提取码错误次数过多|文件不存在|已被删除|已被取消共享|链接失效|分享已过期/i;

/** P1-4 百度网盘 /s/ 短链：走公开 shorturlinfo 接口精确核验（无需登录）。无法判定返回 null。 */
async function verifyBaiduPan(url) {
  const short = (url.match(/pan\.baidu\.com\/s\/([A-Za-z0-9_-]+)/i) || [])[1];
  if (!short) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://pan.baidu.com/api/shorturlinfo?shorturl=${encodeURIComponent(short)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": pickUA(), "Referer": "https://pan.baidu.com/", "Accept": "application/json" },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const errno = Number(data && data.errno);
    if (errno === 0) return { status: "live", note: "百度网盘分享有效（接口确认存在）" };
    if (data && data.info && data.info.errcode) return { status: "expired", note: "百度网盘分享疑似已失效 / 过期" };
    if ([-25, -12, -10, -7, 2].includes(errno)) return { status: "expired", note: "百度网盘分享疑似已失效 / 过期（接口 errno " + errno + "）" };
    return null; // 未识别的 errno，回退壳页扫描
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 核验单条网盘分享地址：优先接口精确核验（百度）→ 可达 + 是否命中失效标记；无法在线确认文件存在 → unknown。 */
async function verifyPan(url) {
  if (/pan\.baidu\.com\/s\//i.test(url)) {
    const precise = await verifyBaiduPan(url);
    if (precise) return precise;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4500);
  const UA = {
    "User-Agent": pickUA(),
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: UA });
    if (!r.ok) return { status: "dead", note: `分享页访问失败（HTTP ${r.status}）` };
    // 读取前 ~60KB 扫描“已失效 / 过期”标记（部分网盘服务端直出失效页）
    const reader = r.body.getReader();
    let buf = "";
    let stopped = false;
    while (!stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString("utf8");
      if (buf.length > 60000) stopped = true;
    }
    if (EXPIRED_RE.test(buf)) return { status: "expired", note: "网盘分享疑似已失效 / 过期" };
    return { status: "unknown", note: "分享页可访问，需在客户端确认文件是否仍有效" };
  } catch (e) {
    return { status: "unknown", note: "无法在线核验（超时 / 网络被拦截）" };
  } finally {
    clearTimeout(t);
  }
}

/** 批量核验直链：网盘并行核验（并发受限），磁力 / ed2k 标注“需客户端”。 */
async function verifyLinks(items, onProgress) {
  const panItems = items.filter((i) => i.kind === "pan");
  const others = items.filter((i) => i.kind !== "pan");
  const total = panItems.length;
  let checked = 0, live = 0, expired = 0, dead = 0, unknown = 0, unverifiable = 0;
  const bump = () => { if (onProgress) onProgress({ checked, total, live, expired, dead, unknown }); };
  const CONC = 10;
  let idx = 0;
  async function worker() {
    while (idx < panItems.length) {
      const it = panItems[idx++];
      const v = await verifyPan(it.url);
      it.verified = v;
      checked++;
      if (v.status === "live") live++;
      else if (v.status === "expired") expired++;
      else if (v.status === "dead") dead++;
      else unknown++;
      bump();
    }
  }
  const n = Math.min(CONC, Math.max(panItems.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  for (const it of others) {
    it.verified = it.kind === "magnet"
      ? { status: "unverifiable", note: "磁力需迅雷 / qBittorrent 客户端，无法在线核验可用性" }
      : { status: "unverifiable", note: "eD2k 需 eMule 客户端，无法在线核验" };
    unverifiable++;
  }
  bump();
  return { live, expired, dead, unknown, unverifiable, total: items.length };
}

/**
 * P0-3 索引站磁力 → 标准直链项（带做种/大小元数据，优先展示）。
 */
function buildIndexMagnets(torrents, cap = 10) {
  const out = [];
  let i = 0;
  for (const t of torrents.slice(0, cap)) {
    i++;
    const good = Number(t.seeders) > 0 || !!t.size;
    const parts = [`来源 ${t.srcName} 索引站`];
    if (t.size) parts.push(`大小 ${t.size}`);
    if (Number(t.seeders) > 0) parts.push(`做种 ${t.seeders}`);
    out.push({
      title: t.title && String(t.title).trim() ? String(t.title).trim() : `磁力链接 #${i}`,
      url: t.url,
      rating: good ? "良好" : "一般",
      meta: `${parts.join(" · ")}；用迅雷 / qBittorrent 添加，无需提取码。`,
      flags: good ? ["索引站来源"] : [],
      source: t.srcName,
      kind: "magnet",
      seeders: Number(t.seeders) || 0,
      size: t.size || "",
      fromIndex: true,
    });
  }
  return out;
}

/**
 * P0-3 搜索结果中直接暴露的网盘分享地址 → 标准网盘直链项（标注来源，交核验；同 URL 合并并尽量带提取码）。
 */
function buildWebPanLinks(pans, cap = 10) {
  const byUrl = new Map();
  for (const p of pans || []) {
    const u = String(p.url || "").replace(/[)，。；，\s'\"]+$/g, "");
    if (!/^https?:\/\//i.test(u)) continue;
    const cur = byUrl.get(u);
    if (!cur) byUrl.set(u, { ...p, url: u });
    else if (p.code && !cur.code) cur.code = p.code;
  }
  const out = [];
  let i = 0;
  for (const p of byUrl.values()) {
    if (i >= cap) break;
    i++;
    const host = safeHost(p.url);
    const label = host.replace(/^pan\./, "").replace(/\.com$/, "").replace(/\.cn$/, "") || "网盘";
    const titleM = p.title && String(p.title).trim();
    const hasCode = !!p.code;
    out.push({
      title: titleM ? titleM.slice(0, 40) : `${label}分享地址 #${i}`,
      url: p.url,
      code: p.code || "",
      rating: hasCode ? "良好" : "需验证",
      meta: `来自「${p.hostIntent || "搜索摘要"}」结果${p.hitTitle ? `《${String(p.hitTitle).slice(0, 36)}》` : ""}中的网盘地址${hasCode ? "，已附提取码；点开直接填码即可转存 / 下载。" : "；点开确认有效性与提取码。"}`,
      flags: hasCode ? ["来自搜索结果", "已附提取码"] : ["来自搜索结果", "需验证提取码"],
      source: p.hostIntent || "搜索摘要",
      kind: "pan",
    });
  }
  return out;
}

/** 深抠优先级打分：网盘/磁力站 > 资源社区 > 通用资讯页；搜索壳页判 9（拒绝深抠，抓了也是白抓）。 */
function deepScore(host) {
  const h = String(host || "").toLowerCase();
  if (/pan\.|alipan|aliyundrive|quark|xunlei|189\.cn|115\.com|lanzou/.test(h)) return 0;
  if (/bt4g|torrentkitty|zhongziso|pansou|cilicat|btdig|1337x|kickass|magnet/gi.test(h)) return 1;
  if (/tieba\.baidu|zhidao\.baidu|xiaokupan|1lou|remux|dy2018|ygdy8|neets|forum|bbs|blog|csdn|ithome/.test(h)) return 2;
  if (/sogou\.com|so\.com|bing\.com|baidu\.com|microsoft|360\.cn|chinaz|hao123/.test(h)) return 9;
  return 3;
}

/** 多来源资源页去重（按 URL 归一化去末尾斜杠）。 */
function dedupePages(pages) {
  const seen = new Map();
  for (const p of pages) {
    let key = p.url;
    try { key = new URL(p.url).href.replace(/\/$/, ""); } catch { /* 保留原文 */ }
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * 检索主流程（可上报事件）：连接 → 查询规范化 → Bing 矩阵 + 索引站直查 →
 * 资源页深链提取 → 直链核验 → 构造结果。
 * @param {string} q
 * @param {(o:object)=>void} emit  事件回调（SSE 用；JSON 模式下传 noop）
 * @returns {Promise<object>} 含 groups / verify / tools 的结构化结果
 */
async function runPipeline(q, emit) {
  emit({ type: "tool", id: "connect", name: "连接实时检索代理", status: "ok", detail: "同源代理 :8789 就绪" });

  const nq = normalizeMovieQuery(q);
  const nqNote = nq.canon && nq.canon !== nq.name
    ? `（规范名：${nq.canon}${nq.en ? " / " + nq.en : ""}${nq.year ? " / " + nq.year : ""}）`
    : nq.en || nq.year
      ? `（${[nq.en, nq.year].filter(Boolean).join(" / ")}）`
      : "";

  // —— 阶段一：Bing 查询矩阵 + 磁力/网盘索引站直查（可并行）——
  const [bing, sites] = await Promise.all([
    (async () => {
      emit({ type: "tool", id: "bing", name: "Bing 定向检索（查询矩阵）", status: "running" });
      const r = await searchBing(nq.name);
      emit({ type: "tool", id: "bing", name: "Bing 定向检索", status: "ok", detail: `命中 ${r.bingHit} 个结果页${nqNote}` });
      return r;
    })(),
    (async () => {
      emit({ type: "tool", id: "sources", name: "磁力 / 网盘多源直查", status: "running" });
      const r = await searchSiteSources(nq.name);
      emit({
        type: "tool", id: "sources", name: "磁力 / 网盘多源直查", status: r.torrents.length || r.pans.length ? "ok" : "warn",
        detail: `索引磁力 ${r.torrents.length} · 摘要网盘 ${r.pans.length} · 线索页 ${r.pages.length}`,
      });
      return r;
    })(),
  ]);

  const { pageItems, bingHit } = bing;
  // 深抠池：合并 Bing + 多源页 → 剔除信息站/搜索壳页 → 资源域优先 → 取前 12 页
  const pagePool = dedupePages([...pageItems, ...sites.pages])
    .filter((it) => !isInfoHost(it))
    .map((it) => ({ it, pri: deepScore(it.host) }))
    .filter((x) => x.pri < 9)
    .sort((a, b) => a.pri - b.pri)
    .map((x) => x.it)
    .slice(0, 12);

  emit({ type: "tool", id: "extract", name: "资源页深链提取（并行抓取 + 迅雷解码）", status: "running" });
  const deepLinks = await extractDirectLinks(pagePool);
  emit({
    type: "tool", id: "extract", name: "资源页深链提取", status: "ok",
    detail: `抓取 ${Math.min(pagePool.length, 12)} 页 · 提取 ${deepLinks.length} 条直链`,
  });

  const directLinks = [
    ...buildIndexMagnets(sites.torrents),
    ...deepLinks,
    ...buildWebPanLinks(sites.pans),
  ];

  emit({ type: "tool", id: "verify", name: "直链可达性 / 网盘有效核验", status: "running" });
  const v = await verifyLinks(directLinks, (p) => emit({ type: "verify", ...p }));
  emit({
    type: "tool", id: "verify", name: "直链核验", status: "ok",
    detail: `网盘 ${v.total} 条 → 失效/过期 ${v.expired} · 访问失败 ${v.dead} · 待确认 ${v.unknown}；磁力/ed2k ${v.unverifiable} 条需客户端`,
  });

  return buildResult(q, { pageItems: pagePool, directLinks, verify: v });
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

function buildResult(query, { pageItems, directLinks, verify }) {
  // 仅保留用户要的直链类型（磁力 / 网盘 / ed2k），按类型分别限量，放宽上限
  const cap = { pan: 14, magnet: 10, ed2k: 3 };
  const byKind = { pan: [], magnet: [], ed2k: [] };
  for (const d of directLinks || []) {
    const k = d.kind;
    if (byKind[k] && byKind[k].length < cap[k]) byKind[k].push(d);
  }
  // 网盘内排序：先按核验状态（待确认 > 疑似失效 > 访问失败），再按类型优先级（夸克最前），同类型带提取码优先
  const ndPri = (it) => (NETDISK_PRIORITY[it.type] != null ? NETDISK_PRIORITY[it.type] : 99);
  const vrOrder = { unknown: 0, expired: 1, dead: 2 };
  byKind.pan.sort((a, b) => {
    const va = a.verified ? vrOrder[a.verified.status] : 0;
    const vb = b.verified ? vrOrder[b.verified.status] : 0;
    if (va !== vb) return va - vb;
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
      note: "真实磁力链接，点击或复制后用迅雷 / qBittorrent 添加，无需提取码；磁力需客户端，无法在线核验可用性。",
      items: magItems,
    });
  }
  if (panItems.length) {
    groups.push({
      kind: "pan",
      title: "📦 网盘直链（已核验）",
      note: "真实网盘分享地址（夸克 / 阿里云盘 / 迅雷云盘 / 百度网盘等），已按「待确认优先、失效/失败置底」+「夸克优先」排列；红色项为疑似失效或访问失败，已沉底。",
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

  const v = verify || { expired: 0, dead: 0, unknown: 0, unverifiable: 0, total: 0 };
  const codeCount = panItems.filter((d) => d.code).length;
  const idxCount = (directLinks || []).filter((d) => d.fromIndex).length;
  const magNote = (magItems.length)
    ? ` + 磁力直链 ${magItems.length} 条${idxCount ? `（含索引站来源 ${idxCount} 条）` : ""}（需客户端核验）`
    : "";
  return {
    query,
    keyword: "影视搜索",
    summary: live
      ? `已为「${query}」实时检索并核验：网盘分享 ${panItems.length} 条（其中 ${v.expired} 条疑似失效/过期、${v.dead} 条访问失败、${v.unknown} 条待客户端确认，已按可用优先排列）${magNote}。`
      : `未检索到直链，已附分层检索入口（点开手动检索）。`,
    generatedAt: new Date().toISOString(),
    groups,
    tips: [
      "磁力链接用迅雷 / qBittorrent 添加；百度网盘链接点开填提取码。",
      "绿色/黄色为待确认项，点开即可判断是否仍有效；红色为已核验失效/失败，建议跳过。",
      "资源到手后请核对分辨率、语言、集数是否匹配需求。",
    ],
    warnings: [
      "网盘分享均为「页可访问」即视为待确认，最终有效性以客户端打开为准；系统已尽力剔除明显失效/过期的分享。",
      "磁力 / ed2k 需对应客户端，无法在线核验可用性。",
    ],
    live,
    verify: v,
    tools: [
      { id: "connect", name: "连接实时检索代理", status: "ok", detail: "同源代理 :8789" },
      { id: "bing", name: "Bing 定向检索", status: "ok", detail: `命中 ${pageItems ? Math.min(pageItems.length, 8) : 0} 个资源页` },
      { id: "extract", name: "资源页深链提取 + 迅雷解码", status: "ok", detail: `提取 ${directCount} 条直链` },
      {
        id: "verify", name: "直链可达性 / 网盘有效核验",
        status: (v.expired + v.dead) > 0 ? "warn" : "ok",
        detail: `失效/过期 ${v.expired} · 访问失败 ${v.dead} · 待确认 ${v.unknown} · 磁力/ed2k ${v.unverifiable} 需客户端`,
      },
    ],
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
  // 缓存命中直接返回（避免重复抓取）；&fresh=1 强制绕过缓存（用于开发验证新逻辑）
  let fresh = false;
  try { fresh = new URL(req.url, "http://localhost").searchParams.get("fresh") === "1"; } catch { /* ignore */ }
  log("检索：", q, fresh ? "(fresh)" : "");
  if (!fresh) {
    const cached = cacheGet(q);
    if (cached) { sendJSON(res, 200, cached); return; }
  }
  const noop = () => {};
  let result;
  try {
    result = await runPipeline(q, noop);
  } catch (e) {
    warn("实时检索异常（已忽略，回退入口）：", e.message);
    result = buildResult(q, { pageItems: [], directLinks: [], verify: { expired: 0, dead: 0, unknown: 0, unverifiable: 0, total: 0 } });
  }
  cacheSet(q, result);
  sendJSON(res, 200, result);
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** SSE 流式检索：逐事件上报 工具调用 / 核验进度 / 最终结果，供独立窗口展示检索过程。 */
async function handleStream(req, res) {
  const q = readQuery(req);
  if (!q) {
    sseSend(res, { type: "error", message: "缺少查询参数 q（影视名称）" });
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const emit = (o) => sseSend(res, o);
  log("流式检索：", q);
  try {
    const result = await runPipeline(q, emit);
    emit({ type: "done", result });
  } catch (e) {
    warn("流式检索异常：", e.message);
    emit({ type: "error", message: e.message || "检索异常" });
  } finally {
    res.end();
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/moviesearch/stream") {
        return await handleStream(req, res);
      }
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
