#!/usr/bin/env node
/**
 * 油价抓取 · J.A.R.V.I.S. Cyber Audio Spectrum — 油价卡真实数据源
 *
 * 为什么需要它：浏览器直连第三方站点会遇 CORS，且抓取逻辑不宜进前端 bundle。
 * 本模块在 Node 侧抓取「油价网」上海 92# 汽油零售指导价，解析为面板可用结构：
 *
 *   - 全国页表格 -> 上海 92# 单价（price）
 *   - 页面摘要 -> 上轮调价日 / 涨跌方向 / 每升幅度 / 下一轮窗口（nextAdjust / prevAdjust）
 *
 * 说明：国内成品油零售价由发改委约每 10 个工作日统一调整一次，故「实时」指
 * 「当前真实指导价 + 自动刷新」，并非逐秒跳动（那是国际原油的玩法）。
 * 如需接入官方/商业实时行情 API，替换 fetchOilHtml()/parse() 即可，对外结构不变。
 *
 * 端口：由 oilApi.mjs 持有（默认 8795），经 Vite 同源代理 /api/oil 转发到浏览器。
 */

const SOURCE_URL = "http://www.qiyoujiage.com/92.shtml";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟，避免频繁爬取第三方站点
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let cache = { at: 0, payload: null };

const round2 = (n) => Math.round(n * 100) / 100;

/** "2026年8月14日24时" -> Date（当地日期零点）。
 *  面板以「窗口日期」呈现并在「今日」补 24:00，故此处取日期零点即可。 */
function cnDateToISO(s) {
  const m = String(s || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/** 带超时的文本抓取；任何异常返回空串，由调用方判定失败。 */
async function fetchOilHtml(ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(SOURCE_URL, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!r.ok) throw new Error(`油价网返回 ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 解析 HTML -> 面板结构（只看「上海 92#」一行；其他省份丢弃）。
 *  调价信息（涨跌方向/幅度/上下次窗口）来自 meta description，城市无关。
 *  解析失败抛错。 */
function parse(html) {
  // 省份 -> 92# 价：<a href="/xx.shtml">NAME</a></td><td ...>PRICE</td>
  const rowRe = /href="\/[\w]+\.shtml">([^<]+)<\/a><\/td><td[^>]*>([\d.]+)<\/td>/g;
  let shanghaiPrice = null;
  let m;
  while ((m = rowRe.exec(html))) {
    if (m[1].trim() === "上海") {
      shanghaiPrice = parseFloat(m[2]);
      break;
    }
  }
  if (shanghaiPrice == null || isNaN(shanghaiPrice)) {
    throw new Error("未解析到上海 92# 价格");
  }
  const price = round2(shanghaiPrice);

  // 摘要（meta description）：今日92号汽油是YYYY年M月D日H时，<上调|下调>...（X元/升-Y元/升）...新一次...将在YYYY年M月D日H时
  const desc = html.match(/今日92号汽油是[^<]+/)?.[0] || "";
  const dir = /下调/.test(desc) ? "down" : /上调/.test(desc) ? "up" : "hold";
  const dLow = desc.match(/\((\d+\.\d+)元\/升/);
  const delta = dLow ? parseFloat(dLow[1]) : 0; // 用区间下限；如需更准可用中点 (lo+hi)/2
  const lastAdjust = cnDateToISO(
    desc.match(/今日92号汽油是([\d]+年[\d]+月[\d]+日[\d]+时)/)?.[1] || ""
  );
  const nextAdjust = cnDateToISO(
    desc.match(/新一次92汽油价格调整将在([\d]+年[\d]+月[\d]+日[\d]+时)/)?.[1] || ""
  );

  const change = dir === "down" ? -delta : dir === "up" ? delta : 0;
  const prevClose = round2(price - change);

  const dirText = dir === "down" ? "下调" : dir === "up" ? "上调" : "搁浅";
  const forecastText =
    dir === "hold" ? "预计搁浅" : `预计${dirText}${delta.toFixed(2)}元/升`;

  return {
    ok: true,
    data: { name: "上海92#汽油", unit: "元/升", price, prevClose },
    forecast: { direction: dir, text: forecastText },
    nextAdjust: nextAdjust ? nextAdjust.toISOString() : null,
    prevAdjust: lastAdjust ? lastAdjust.toISOString() : null,
    change,
    delta,
    direction: dir,
    source: "油价网 qiyoujiage.com",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 获取油价（带 10 分钟内存缓存）。
 * 成功返回最新 payload；抓取失败但有旧缓存则返回 stale 标记；
 * 既无缓存又失败则抛错，由 HTTP 层转 502。
 */
export async function getOilPrice() {
  if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true };
  }
  try {
    const html = await fetchOilHtml();
    if (!html) throw new Error("油价网返回空内容");
    const payload = parse(html);
    cache = { at: Date.now(), payload };
    return { ...payload, cached: false };
  } catch (e) {
    if (cache.payload) {
      return { ...cache.payload, cached: true, stale: true, error: e.message };
    }
    throw e;
  }
}
