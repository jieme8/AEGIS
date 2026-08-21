/**
 * 影视「影片发现」渲染 · 前端（加法模块，不修改 movieSearch.js 检索链路）
 *
 * 职责：把 P0 的元数据检索（server/movie-meta.mjs，经 /api/movie）渲染成卡片网格，
 * 嵌入现有 @影视搜索 窗口顶部。每张卡片的「获取下载链接」复用既有 searchMovies
 * （Bing 深抠）→ renderMovieResults，从而满足「卡片 + 每卡获取 + 下载链接列表」。
 *
 * 健壮性（对齐「现有功能不出问题」）：
 *   - 所有网络/渲染均 try/catch；元数据服务离线时只显示一行提示，绝不阻断下方 Bing 结果。
 *   - 复用 movieSearch.js 的 searchMovies / renderMovieResults，不重复造轮子。
 *   - 动态文本统一 esc() 转义，避免 XSS。
 */

import { searchMoviesMeta, getSimilarMovies, parseMovieQuery } from "./movieMeta.js";
import { searchMovies, renderMovieResults } from "./movieSearch.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceLabel(src) {
  if (src === "merged") return "种子+TMDB";
  if (src === "tmdb") return "TMDB";
  return "本地种子";
}

function cardHTML(m) {
  const tags = (m.tags || []).map((t) => '<span class="msd-tag">' + esc(t) + "</span>").join("");
  const cast = (m.cast || []).slice(0, 3).map((c) => esc(c)).join("、");
  const titleAttr = esc(m.title || "");
  const posterImg = m.poster
    ? '<img class="msd-poster-img" src="' + esc(m.poster) + '" alt="' + titleAttr + '" loading="lazy"/>'
    : '<span class="msd-ph">🎬</span>';
  return (
    '<div class="msd-card" data-title="' + titleAttr + '">' +
      '<div class="msd-poster" aria-hidden="false">' + posterImg + '</div>' +
      '<div class="msd-title">' + esc(m.title || "") + "</div>" +
      '<div class="msd-meta">' +
        esc(m.type || "—") + " · " + esc(m.region || "—") + " · " + esc(String(m.year || "—")) +
      "</div>" +
      '<div class="msd-rating">★ ' + esc(String(m.rating != null ? m.rating : "—")) + "</div>" +
      '<div class="msd-sub">导演：' + esc(m.director || "未知") + "</div>" +
      (cast ? '<div class="msd-sub">主演：' + cast + "</div>" : "") +
      (tags ? '<div class="msd-tags">' + tags + "</div>" : "") +
      '<button class="msd-get" type="button" data-title="' + titleAttr + '">获取下载链接</button>' +
      '<div class="msd-links" hidden></div>' +
    "</div>"
  );
}

// 卡片「获取下载链接」点击：复用现有 searchMovies（Bing 深抠）→ renderMovieResults
function onCardClick(e) {
  const btn = e.target.closest(".msd-get");
  if (!btn) return;
  const card = btn.closest(".msd-card");
  const linksEl = card ? card.querySelector(".msd-links") : null;
  if (!linksEl) return;
  if (linksEl.dataset.loaded === "1") {
    linksEl.hidden = !linksEl.hidden; // 已加载则折叠/展开
    btn.textContent = linksEl.hidden ? "获取下载链接" : "收起下载链接";
    return;
  }
  const title = btn.getAttribute("data-title") || "";
  btn.disabled = true;
  btn.textContent = "获取中…";
  searchMovies(title)
    .then((res) => {
      linksEl.innerHTML = renderMovieResults(res);
      linksEl.dataset.loaded = "1";
      linksEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "收起下载链接";
    })
    .catch((err) => {
      linksEl.innerHTML = '<div class="msd-links-err">获取失败：' + esc((err && err.message) || "未知错误") + "</div>";
      linksEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "获取下载链接";
    });
}

/**
 * 填充「影片发现」容器（在 @影视搜索 窗口顶部）。容器复用，监听器只绑一次。
 * @param {HTMLElement} container
 * @param {string} query
 */
export async function populateDiscovery(container, query) {
  if (!container) return;
  if (container.dataset.bound !== "1") {
    container.addEventListener("click", onCardClick);
    container.dataset.bound = "1";
  }
  container.innerHTML = '<div class="msd-loading"><span class="mp-spin"></span> 正在检索影片元数据…</div>';
  try {
    const parsed = parseMovieQuery(query);
    const filters = { ...parsed.filters, q: parsed.title || query };
    const data = await searchMoviesMeta(filters);
    const results = data.results || [];
    if (!results.length) {
      container.innerHTML =
        '<div class="msd-empty">未匹配到影片元数据' +
        (parsed.title ? "（" + esc(parsed.title) + "）" : "") +
        "。下方仍提供资源检索入口。</div>";
      return;
    }
    const cards = results.slice(0, 12).map(cardHTML).join("");
    container.innerHTML =
      '<div class="msd-head">🎬 影片发现 · 命中 <b>' + results.length + "</b> 部（" + sourceLabel(data.source) + "）" +
      (parsed.title ? ' · 关键词「' + esc(parsed.title) + "」" : "") + "</div>" +
      '<div class="msd-grid">' + cards + "</div>";
  } catch (e) {
    // 静默降级：元数据服务离线/异常，仅提示，下方 Bing 结果不受影响
    container.innerHTML = '<div class="msd-empty">元数据服务离线，下方仍提供资源检索。</div>';
  }
}
