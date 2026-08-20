// 网页查看器：事件总线 + URL 提取 + 可达性探测
// 让 AI 回复里的链接在独立浮层中打开（iframe 内嵌；禁嵌时回退浏览器），
// 并在 AI 终态时自动提取并探测 URL，仅可达的才自动开窗。

// App 与 useChatController 共用同一个事件名，保持解耦
export const WEBVIEWER_EVENT = "jarvis:open-url";

// 与 renderInlineLinks 的匹配口径一致：裸 http(s) URL（含 markdown 链接里的 URL）
const URL_RE = /https?:\/\/[^\s<]+/g;

// 从文本提取去重后的 URL，并剔除尾部常见标点。
// 只剥离「。,，,」三种句子收尾标点，**不再剥离「)」「）」**：
// 维基百科等合法 URL 含括号（如 https://en.wikipedia.org/wiki/Foo_(bar)），
// 原版会把右括号吃掉导致 URL 错误、页面打不开。
export function extractUrls(text) {
  if (!text) return [];
  const out = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(String(text))) !== null) {
    let u = m[0].replace(/[。，,]+$/, "").trim();
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

// URL 归一化 key：用于去重比较。忽略：
//   - 协议（http/https）
//   - www. 前缀
//   - 尾部斜杠
//   - **fragment（#hash）**：同一文档的不同锚点视为同一页，
//     如 https://x.com 与 https://x.com#installation 不再重复开窗。
// 保留 path 与 query（含动态参数区别）。
export function urlKey(u) {
  if (!u) return "";
  try {
    const url = new URL(u);
    const host = url.host.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return host + path + url.search;
  } catch {
    return String(u).trim().toLowerCase();
  }
}

// 派发开窗事件；urls 可以是字符串或数组，仅保留 http(s)
export function dispatchOpenUrls(urls, opts = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => /^https?:\/\//i.test(u));
  if (!list.length) return;
  window.dispatchEvent(
    new CustomEvent(WEBVIEWER_EVENT, { detail: { urls: list, auto: !!opts.auto } })
  );
}

// 可达性探测：HEAD + no-cors，仅网络层失败（DNS/离线/超时）判定为不可达。
// 注意：跨域站点的 CORS 不会让 no-cors 请求抛错（返回 opaque），故“可达”≈“网络可达”。
export async function probeUrl(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
