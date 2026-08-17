/**
 * 影视搜索指令模块（前端核心）
 *
 * 严格约定指令格式：  @影视搜索 <影视名称>
 *   - 必须以 "@影视搜索" 作为前缀（关键字固定为「影视搜索」）
 *   - 其后为影视名称参数（可含年份 / 集数 / 分辨率等附加描述）
 *   - 仅当消息匹配该约定时才触发检索；否则原样走普通对话。
 *
 * 检索策略（对齐桌面端「影视搜索v4.1.md」分层工作流）：
 *   阶段零 知识库直连 —— 已知专业资源站点（如 fx57.cn 动漫专站）直达检索入口；
 *   阶段一 通用搜索 —— 百度 / Bing / Google 预填关键词的精准检索入口；
 *   阶段二 交叉验证 —— 由 Node 侧代理尝试真实抓取并提取磁力链接（best-effort）；
 *   阶段三 结构化输出 —— 评级 / 元数据 / 来源 / 验证标记 / 下载建议。
 *
 * 安全：所有用户可控文本经 escapeHtml 处理；URL 仅允许 http/https，杜绝 javascript: 等注入。
 * 诚实原则：绝不伪造磁力哈希；未真实抓取到的结果仅以「检索入口」形式呈现，并明确标注需验证。
 */

export const MOVIE_SEARCH_KEYWORD = "影视搜索";
export const MOVIE_SEARCH_PREFIX = "@" + MOVIE_SEARCH_KEYWORD; // "@影视搜索"

/**
 * @ 指令快捷列表（供输入框「输入 @ 弹出下拉」使用）。
 * 未来新增 @ 命令时，只需在此数组追加一项即可，输入框下拉会自动包含。
 *   - id     : 唯一标识
 *   - label  : 下拉中展示的指令文本（通常以 @ 开头）
 *   - desc   : 下拉中展示的简短说明
 *   - insert : 选中后插入输入框的文本（一般末尾带一个空格，方便继续输入参数）
 *   - match  : 校验「插入后用户发的消息」是否属于该指令（与 parseCommand 共用约定）
 */
export const AT_COMMANDS = [
  {
    id: "movie-search",
    label: MOVIE_SEARCH_PREFIX,        // "@影视搜索"
    desc: "实时检索影视资源的磁力 / 网盘直链",
    insert: MOVIE_SEARCH_PREFIX + " ", // "@影视搜索 "
  },
];

// —— 一键复制（供结果卡片内联按钮调用；含 execCommand 兜底，localhost 安全上下文下可用）——
if (typeof window !== "undefined") {
  window.__copyMovieLink = (btn, text) => {
    const restore = () => {
      const o = btn.getAttribute("data-label") || "复制";
      btn.textContent = o;
    };
    const done = () => {
      btn.textContent = "已复制";
      setTimeout(restore, 1500);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    } catch {
      fallbackCopy(text, done);
    }
  };
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch {
      /* 忽略 */
    }
  }
}

// —— 通用搜索引擎（阶段一）——
const SEARCH_ENGINES = [
  {
    name: "百度",
    base: "https://www.baidu.com/s?wd=",
    suffix: " 磁力 种子 4K 1080P BT 下载",
  },
  {
    name: "Bing",
    base: "https://www.bing.com/search?q=",
    suffix: " 磁力 种子 4K 1080P BT 下载",
  },
  {
    name: "Google",
    base: "https://www.google.com/search?q=",
    suffix: " magnet torrent 4K 1080P download",
  },
];

// —— 磁力 / BT 聚合（阶段三入口）——
const MAGNET_SITES = [
  { name: "BT4G 磁力索引", base: "https://bt4gprx.com/search?q=" },
  { name: "TorrentKitty", base: "https://www.torrentkitty.tv/search?q=" },
];

// —— 网盘 / 云资源（阶段三入口）——
const CLOUD_SITES = [
  {
    name: "百度网盘检索",
    base: "https://www.baidu.com/s?wd=",
    suffix: " 网盘 资源 提取码",
  },
];

const enc = (s) => encodeURIComponent(s);

/**
 * 严格解析影视搜索指令。
 * @param {string} text 原始输入
 * @returns {{matched:boolean, query?:string, error?:string}}
 *   matched=false       非本指令（走普通对话）
 *   matched=true,error="empty"  指令正确但缺少名称（应提示用户输入）
 *   matched=true,query   解析成功
 */
export function parseCommand(text) {
  if (typeof text !== "string") return { matched: false };
  const t = text.trim();
  if (!t.startsWith(MOVIE_SEARCH_PREFIX)) return { matched: false };
  // 取前缀之后的内容作为名称参数：剥离前导空白 / 冒号（兼容 "@影视搜索：名称" 写法）
  const rest = t.slice(MOVIE_SEARCH_PREFIX.length).replace(/^[\s：:]+/, "").trim();
  if (rest.length === 0) return { matched: true, query: "", error: "empty" };
  return { matched: true, query: rest };
}

/** 仅允许 http/https，防 javascript:/data: 等注入。 */
function safeUrl(url) {
  if (typeof url !== "string") return "";
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return "";
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 评级 → 卡片配色 class（r-good/r-ok/r-mid/r-warn） */
function ratingClass(rating) {
  switch (String(rating)) {
    case "优秀":
      return "r-good";
    case "良好":
      return "r-ok";
    case "一般":
      return "r-mid";
    default:
      return "r-warn"; // 需验证
  }
}

/**
 * 构造分层检索入口（浏览器本地兜底 / 结构化骨架）。
 * 返回与 Node 代理一致的分组结构，全部为「点击直达」入口，不含伪造磁力。
 * @param {string} query
 */
export function buildSearchGroups(query) {
  const q = query;

  const engineItems = SEARCH_ENGINES.map((e) => ({
    title: `${e.name} · 综合精准检索`,
    url: safeUrl(e.base + enc(q + (e.suffix || ""))),
    rating: "良好",
    meta: "通用搜索引擎，已预填「名称 + 磁力/种子/4K/BT」关键词。",
    flags: [],
    source: e.name,
  }));

  const magnetItems = MAGNET_SITES.map((s) => ({
    title: s.name,
    url: safeUrl(s.base + enc(q)),
    rating: "一般",
    meta: "磁力 / BT 聚合索引，点击在新标签检索；聚合站若需登录才能显示完整链接，请按站点要求操作。",
    flags: ["需验证"],
    source: s.name,
  }));

  const cloudItems = CLOUD_SITES.map((s) => ({
    title: s.name,
    url: safeUrl(s.base + enc(q + (s.suffix || ""))),
    rating: "一般",
    meta: "网盘 / 云资源检索入口，建议优先核对提取码与文件完整性。",
    flags: ["需验证"],
    source: s.name,
  }));

  return [
    {
      kind: "engine",
      title: "手动检索入口 · 通用搜索",
      note: "已预填精准关键词，点击在新标签查看结果。",
      items: engineItems,
    },
    {
      kind: "magnet",
      title: "手动检索入口 · 磁力 / BT 聚合",
      note: "磁力链接聚合索引，结果需自行核对做种与完整性。",
      items: magnetItems,
    },
    {
      kind: "cloud",
      title: "手动检索入口 · 网盘 / 云资源",
      note: "云盘资源检索入口。",
      items: cloudItems,
    },
  ];
}

function buildFallbackResult(query) {
  return {
    query,
    keyword: MOVIE_SEARCH_KEYWORD,
    summary:
      "未连接到实时检索代理，以下仅为手动检索入口（无法返回真实磁链 / 网盘地址）。" +
      "请确认影视搜索代理已启动：运行 `npm run dev` 会自动拉起代理；若仍离线，检查 8789 端口是否被占用。",
    generatedAt: new Date().toISOString(),
    groups: buildSearchGroups(query),
    tips: [
      "优先选择做种数 > 0 的资源，下载更快更完整。",
      "资源到手后请核对分辨率、语言、集数是否匹配需求。",
      "系统仅提供检索入口与已抓取的公开链接，绝不自动开始下载。",
    ],
    warnings: [
      "聚合站页面若需登录才能看到完整链接，请直接按站点提示操作，勿反复抓取。",
      "未经验证的资源（做种为 0 / 缺分辨率）可能难以下载或信息不全。",
    ],
    live: false,
  };
}

/**
 * 执行影视检索：优先调用 Node 代理 /api/moviesearch（可返回真实抓取的磁力），
 * 失败 / 不可达时回退到浏览器本地构造的检索入口（功能不依赖后端）。
 * @param {string} query
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<object>} 结构化结果（与 buildSearchGroups 同向）
 */
export async function searchMovies(query, { timeoutMs = 15000 } = {}) {
  const fallback = buildFallbackResult(query);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`/api/moviesearch?q=${enc(query)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const data = await res.json();
    if (!data || !Array.isArray(data.groups) || data.groups.length === 0) return fallback;
    // 以服务端返回为准（含可能的实时抓取结果）；补齐本地兜底字段
    return {
      ...fallback,
      ...data,
      query,
      keyword: MOVIE_SEARCH_KEYWORD,
      live: !!data.live,
    };
  } catch (e) {
    // 代理未启动 / 网络异常：静默回退到本地检索入口，保证功能可用
    return fallback;
  }
}

/** 把结构化结果转为纯文本（用于历史持久化 / 复制）。 */
export function resultToPlainText(result) {
  if (!result) return "";
  const lines = [`影视搜索：${result.query}`, result.summary || "", ""];
  for (const g of result.groups || []) {
    lines.push(`【${g.title}】`);
    for (const it of g.items || []) {
      lines.push(`- ${it.title} (${it.rating}) → ${it.url}`);
      if (it.meta) lines.push(`  ${it.meta}`);
    }
    lines.push("");
  }
  (result.tips || []).forEach((t) => lines.push(`💡 ${t}`));
  (result.warnings || []).forEach((w) => lines.push(`⚠️ ${w}`));
  return lines.join("\n");
}

/**
 * 渲染结构化结果为安全 HTML（供聊天气泡 innerHTML）。
 * 所有动态文本经 escapeHtml；链接经 safeUrl 校验。
 * @param {object} result
 * @returns {string} HTML 片段
 */
export function renderMovieResults(result) {
  if (!result) return "";
  const q = escapeHtml(result.query || "");
  const summary = escapeHtml(result.summary || "");
  const liveBadge = result.live
    ? '<span class="ms-live">● 含实时直链</span>'
    : '<span class="ms-offline">● 离线 · 仅检索入口</span>';

  // 直链分组（磁力 / 网盘）置顶且按 kind 渲染为「完整明文 + 一键复制」
  const groupsHtml = (result.groups || [])
    .map((g) => {
      const title = escapeHtml(g.title || "");
      const note = escapeHtml(g.note || "");
      const isDirect = g.kind === "magnet" || g.kind === "pan";
      const itemsHtml = (g.items || [])
        .map((it) => (isDirect ? renderDirectItem(it) : renderLinkItem(it)))
        .join("");
      return (
        `<div class="ms-group ms-group-${escapeHtml(g.kind)}">` +
        `<div class="ms-gtitle">${title}<span class="ms-count">${g.items ? g.items.length : 0}</span></div>` +
        (note ? `<div class="ms-gnote">${note}</div>` : "") +
        `<ul class="ms-items">${itemsHtml}</ul>` +
        `</div>`
      );
    })
    .join("");

  const tipsHtml = (result.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const warnsHtml = (result.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");

  return (
    `<div class="movie-search">` +
    `<div class="ms-head">🔍 影视搜索 · <b>${q}</b> ${liveBadge}</div>` +
    `<div class="ms-summary">${summary}</div>` +
    groupsHtml +
    (tipsHtml ? `<div class="ms-tips"><div class="ms-sect">💡 下载建议</div><ul>${tipsHtml}</ul></div>` : "") +
    (warnsHtml ? `<div class="ms-warns"><div class="ms-sect">⚠️ 验证提示</div><ul>${warnsHtml}</ul></div>` : "") +
    `</div>`
  );
}

/** 直链项（磁力 / 网盘）：完整明文 + 提取码（若有）+ 一键复制。 */
function renderDirectItem(it) {
  const url = safeUrl(it.url);
  const href = url || "#";
  const target = url ? ' target="_blank" rel="noopener noreferrer"' : "";
  const isPan = it.kind === "pan";
  const linkText = escapeHtml(it.url); // 完整明文（磁链 / 网盘地址），可见可复制
  const copyAttr = escapeHtml(it.url);
  const codeLine = it.code
    ? `<div class="ms-code">提取码：<b>${escapeHtml(it.code)}</b></div>`
    : "";
  const rating = escapeHtml(it.rating || "需验证");
  const rc = ratingClass(it.rating);
  return (
    `<li class="ms-item ms-direct">` +
    `<a class="ms-link ${isPan ? "ms-pan" : "ms-magnet"}" href="${escapeHtml(href)}"${target}>${linkText}</a>` +
    `<span class="ms-copy" data-label="复制" data-copy="${copyAttr}" onclick="window.__copyMovieLink(this, this.getAttribute('data-copy'))">复制</span>` +
    `<span class="ms-rating ${rc}">${rating}</span>` +
    codeLine +
    `</li>`
  );
}

/** 普通入口项（搜索引擎 / 聚合站 / 资源页）：仅作点击链接。 */
function renderLinkItem(it) {
  const url = safeUrl(it.url);
  const href = url || "#";
  const target = url ? ' target="_blank" rel="noopener noreferrer"' : "";
  const titleEsc = escapeHtml(it.title || url);
  const metaEsc = escapeHtml(it.meta || "");
  return (
    `<li class="ms-item">` +
    `<a class="ms-link" href="${escapeHtml(href)}"${target}>${titleEsc}</a>` +
    (metaEsc ? `<div class="ms-meta">${metaEsc}</div>` : "") +
    `</li>`
  );
}
