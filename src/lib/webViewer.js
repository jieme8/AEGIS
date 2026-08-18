// 网页查看器：事件总线 + URL 提取 + 可达性探测
// 让 AI 回复里的链接在独立浮层中打开（iframe 内嵌；禁嵌时回退浏览器），
// 并在 AI 终态时自动提取并探测 URL，仅可达的才自动开窗。

// App 与 useChatController 共用同一个事件名，保持解耦
export const WEBVIEWER_EVENT = "jarvis:open-url";

// 与 renderInlineLinks 的匹配口径一致：裸 http(s) URL（含 markdown 链接里的 URL）
const URL_RE = /https?:\/\/[^\s<]+/g;

// 从文本提取去重后的 URL，并剔除尾部常见标点（。，,）) 等）
export function extractUrls(text) {
  if (!text) return [];
  const out = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(String(text))) !== null) {
    let u = m[0].replace(/[。，,）)]+$/, "").trim();
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
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
