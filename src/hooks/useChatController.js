import { useEffect, useRef, useState } from "react";
import { MODEL_CONFIG } from "../config/modelConfig.js";
import { parseSSEChunk } from "../lib/sse.js";
import { isDevMode, onDevModeChange } from "../lib/devMode.js";
import { MCPClient } from "../lib/mcpClient.js";
import { ToolCallAccumulator } from "../lib/toolCalls.js";
import { runAgentLoop } from "../lib/agentLoop.js";
import { providerManager } from "../lib/providerManager.js";
import { runImagePipeline } from "../lib/imagePipeline.js";
import { runAutoMemory } from "../lib/autoMemory.js";
import { recallMemories, extractMemoryToolReads } from "../lib/recall.js";
// 渲染前过滤：脱敏 @image#N:"..." / <image_local_path>...</image_local_path> / Windows 路径等本地图片引用
import { sanitizeImageRefs } from "../lib/traceSanitize.js";
import {
  parseCommand,
  searchMovies,
  renderMovieResults,
  streamMovieSearch,
  MOVIE_SEARCH_PREFIX,
  AT_COMMANDS,
} from "../lib/movieSearch.js";
// 影视「影片发现」渲染（元数据卡片，加法接入 @影视搜索 窗口顶部）
import { populateDiscovery } from "../lib/movieDiscovery.js";
// 内容生成后校验引擎：溯源 / 可信度分级，落实「事实准确性为最高优先级」
import { verifyAnswer, extractLiveSources, LEVEL_META } from "../lib/answerVerifier.js";
// 网页查看器：AI 回复链接在独立浮层打开（自动提取全部网址开窗）
import { dispatchOpenUrls, extractUrls } from "../lib/webViewer.js";

// 事实准确性优先 · 系统级约束（最高优先级，追加进 system 提示词，约束每一次回复）
const FACTUALITY_DIRECTIVES =
  "\n\n【事实准确性准则 · 最高优先级】\n" +
  "1. 事实准确性是你回答的最高优先级。凡不确定、无可靠依据或超出你知识范围的内容，必须直接、明确地说明" +
  "（如「我不确定 / 无法确认 / 缺乏权威依据」），绝不编造、不猜测、不产生幻觉、不用含糊措辞掩盖未知。\n" +
  "2. 涉及具体事实、数据、统计、引用、法规、人物言论、来源归属时，必须在回复正文内直接标注来源网址（URL），" +
  "不要仅在末尾或气泡外挂脚注。推荐格式：紧随事实后加 Markdown 链接，例如「发布于 [Flickr](https://www.flickr.com/...)」、" +
  "「摄影师 John Warkentien，参见 [Know Your Meme](https://...)」。" +
  "若无法给出确切 URL，应写明「（来源未确认）」或「（暂无可靠来源 URL）」，不得伪造链接。\n" +
  "3. 在回复末尾用独立一段列出「来源」清单：逐条给出完整 URL，并简要说明可信度（官方 / 权威媒体 / 一般媒体 / 未知）。" +
  "如果正文已内联全部 URL，可省略重复项，但仍需保留「来源：见正文链接」说明。\n" +
  "4. 当内容属于创意 / 虚构 / 假设性创作时，必须在开头显式标注「以下为虚构创作」，避免与事实混淆。\n" +
  "5. 知识有时效边界：你的训练知识有截止日期，无法获取实时数据（股价、天气、突发新闻等）。" +
  "涉及最新动态时，应主动声明局限并建议用户查阅权威来源核实。\n" +
  "6. 所有表述须有据可依；无法溯源的断言应降级为「可能 / 待核实」或明确标注不确定性。";
// 对话位置自动地图标注 → 独立 MapWindow 浮窗（事件驱动）
import { extractLocations, extractLocationsStrict, KNOWN_CITY } from "../lib/locationExtractor.js";
import { parseGeoMarker, parseRoute, parseTextSearch, parseSearchDetail, validateAgainstCity, guessContextCity } from "../lib/mapParse.js";

/**
 * 主对话窗口控制器（集成于频谱可视化器）—— 页面核心交互区。
 * 逻辑与原 chat 脚本 1:1 移植：居中前景主窗口，音频可视化退为背景氛围层。
 * 回复走真实大模型（LongCat）流式输出；接口不可用（网络/密钥/限流）时自动回退本地模拟。
 *
 * 过程可视化：通过 React 状态 trace / traceOpen 暴露「当前对话请求的完整流水线」
 * （请求状态 → 附加上下文 → 实际提示词 → 流式回复），由 ChatTraceDrawer 浮层消费。
 * 浮层在对话发起瞬间自动弹出（setTraceOpen(true)），无需按钮触发。
 */
// 复制文本到剪贴板，并在按钮上给出「已复制」瞬时反馈（不依赖全局 toast）
const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="20 6 9 17 4 12"/></svg>';

function copyText(text, btn) {
  const done = () => {
    if (btn) {
      btn.innerHTML = CHECK_ICON;       // 图标切换为「勾」
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove("copied"); }, 1200);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    // 回退：临时 textarea + execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { /* 忽略 */ }
    done();
  }
}

/**
 * 将 bubble-text 中的 Markdown 链接与裸 URL 渲染为可点击 <a>。
 * - [文本](http://url) → 显示文本，点击打开 URL。
 * - http://url / https://url → 直接显示并点击打开。
 * 文本段落用 createTextNode，链接用 createElement('a')，不引入任意 HTML，防 XSS。
 * 仅对 AI 气泡执行（用户消息保持纯文本）。
 */
function renderInlineLinks(bubble, text) {
  const textSpan = bubble.querySelector(".bubble-text");
  if (!textSpan) return;
  const raw = String(text || "");
  // 同时匹配 Markdown 链接 [text](url) 与裸 URL
  const re = /\[([^\]]+)\]\(([^)]+)\)|https?:\/\/[^\s<]+/g;
  textSpan.textContent = "";          // 清空，后续手动重建文本节点 + 链接
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      textSpan.appendChild(document.createTextNode(raw.slice(last, m.index)));
    }
    if (m[1] != null && m[2] && m[2].startsWith("http")) {
      const a = document.createElement("a");
      a.href = m[2];
      a.textContent = m[1];
      a.className = "chat-md-link";
      a.rel = "noopener noreferrer";
      const url = m[2];
      a.addEventListener("click", (e) => { e.preventDefault(); dispatchOpenUrls([url]); });
      textSpan.appendChild(a);
    } else if (m[0] && m[0].startsWith("http")) {
      const a = document.createElement("a");
      a.href = m[0];
      a.textContent = m[0];
      a.className = "chat-bare-link";
      a.rel = "noopener noreferrer";
      const url = m[0];
      a.addEventListener("click", (e) => { e.preventDefault(); dispatchOpenUrls([url]); });
      textSpan.appendChild(a);
    } else {
      textSpan.appendChild(document.createTextNode(m[0]));
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    textSpan.appendChild(document.createTextNode(raw.slice(last)));
  }
}

// 给气泡挂一个「复制」图标按钮（绝对定位在气泡内右上角，hover 浮现）
// 注意：按钮挂在 bubble 内（而非外层 .chat-msg），这样它的定位锚点是气泡本身，
// 与对话框严丝合缝对齐；且必须落在 .chat-msg 盒子内部，才能保证 :hover 命中、可点击。
// label 用于 title / aria-label（AI 回复称“复制回复”，用户发送内容称“复制内容”）。
function attachCopyButton(bubble, label = "复制回复") {
  const copyBtn = document.createElement("button");
  copyBtn.className = "chat-copy";
  copyBtn.type = "button";
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.title = label;
  copyBtn.setAttribute("aria-label", label);
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyText(bubble.textContent, copyBtn);   // bubble 内仅含文本节点 + 该按钮（按钮无文字），textContent 即正文
  });
  bubble.appendChild(copyBtn);
}

// 气泡溯源脚注：把可信度徽章 / 来源可信度点 / 知识时效边界挂到 AI 回复下方。
// 让每一次对话输出在界面上「可溯源、可验证」，落地事实准确性准则。
function attachProvenanceFooter(wrap, report, opts = {}) {
 try {
  if (!wrap) return;
  if (wrap.querySelector(".chat-source-footer")) return;   // 防重复挂载
  const footer = document.createElement("div");
  footer.className = "chat-source-footer";

  // 可信度 / 状态徽章
  const badge = document.createElement("span");
  if (opts.fallback || opts.error) {
    badge.className = "src-badge " + (opts.fallback ? "lv-sim" : "lv-low");
    badge.textContent = opts.fallback ? "模拟 · 无真实依据" : "失败 · 未溯源";
  } else {
    badge.className = "src-badge " + (report ? LEVEL_META[report.level].cls : "lv-medium");
    badge.textContent = report ? LEVEL_META[report.level].label : "校验中";
  }
  const head = document.createElement("div");
  head.className = "src-head";
  const headLabel = document.createElement("span");
  headLabel.className = "src-head-label";
  headLabel.textContent = "来源与依据";
  head.appendChild(headLabel);
  head.appendChild(badge);

  // 元数据（来源数 / 评分）
  const meta = document.createElement("span");
  meta.className = "src-meta";
  if (opts.fallback || opts.error) {
    meta.textContent = opts.fallback ? "本地模拟回复" : "接口调用失败";
  } else if (report) {
    meta.textContent = `来源 ${report.sourceCount} · 评分 ${report.score}` + (report.required ? ` · 可溯源 ${report.coverage}%` : "");
  }
  head.appendChild(meta);
  footer.appendChild(head);

  // 记忆召回：在来源脚注里显示「本次读取了 N 条长期记忆」，包含 proactive 召回 + LLM 工具调用读取
  const proactiveCount = opts.recall ? (opts.recall.count || 0) : 0;
  const toolReads = Array.isArray(opts.toolReads) ? opts.toolReads : [];
  const toolCount = toolReads.length;
  const totalReads = proactiveCount + toolCount;
  if (opts.recall || toolCount > 0) {
    const memLine = document.createElement("div");
    memLine.className = "src-memory";
    const memLabel = document.createElement("span");
    memLabel.className = "src-memory-label";
    if (opts.recall && opts.recall.enabled === false) {
      memLabel.textContent = "🧠 记忆召回已关闭";
      memLine.classList.add("muted");
    } else if (totalReads > 0) {
      const via =
        proactiveCount > 0 && toolCount > 0
          ? `（主动召回 ${proactiveCount} 条，工具读取 ${toolCount} 条）`
          : proactiveCount > 0
            ? "（主动召回）"
            : "（通过工具调用读取）";
      memLabel.textContent = `🧠 本次读取记忆 ${totalReads} 条 ${via}`;
    } else {
      memLabel.textContent = "🧠 本次未召回相关记忆";
      memLine.classList.add("muted");
    }
    memLine.appendChild(memLabel);
    const chips = document.createElement("div");
    chips.className = "src-memory-chips";
    (opts.recall && opts.recall.entries || []).forEach((e) => {
      const c = document.createElement("span");
      c.className = "src-memory-chip";
      c.textContent = e.key;
      c.title = (e.value || "").slice(0, 200);
      chips.appendChild(c);
    });
    toolReads.forEach((inv) => {
      const c = document.createElement("span");
      c.className = "src-memory-chip tool";
      const key = (inv.args && (inv.args.key || inv.args.query)) || inv.name;
      c.textContent = key;
      c.title = `[${inv.name}] ${typeof inv.result === "string" ? inv.result.slice(0, 200) : JSON.stringify(inv.result || "").slice(0, 200)}`;
      chips.appendChild(c);
    });
    if (chips.children.length) memLine.appendChild(chips);
    footer.appendChild(memLine);
  }

  // 来源可信度点（点击直达）
  if (report && report.sources.length) {
    const list = document.createElement("div");
    list.className = "src-list";
    report.sources.forEach((s) => {
      const a = document.createElement("a");
      a.className = "src-link " + s.trust.cls;
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = (s.host || s.url) + " · " + s.trust.label + "（点击打开）";
      a.textContent = (s.host || s.url) + " · " + s.trust.short;
      list.appendChild(a);
    });
    footer.appendChild(list);
  }

  // 时效边界 / 不确定性说明
  const note = document.createElement("div");
  note.className = "src-note";
  if (opts.fallback) {
    note.textContent = "本地模拟回复，未接入真实模型，内容不可作为事实依据。";
  } else if (opts.error) {
    note.textContent = "响应失败，未生成可溯源内容；详见对话流-请求状态。";
  } else if (report) {
    note.textContent = report.fictionalLabel
      ? "已标注虚构创作：内容非事实，仅供创意参考。"
      : "模型知识有时效边界，关键事实请以权威来源为准。" + (report.hasUncertainty ? " 已声明不确定性。" : "");
  }
  footer.appendChild(note);

  wrap.appendChild(footer);
  // 关键修复：脚注在 finalize() 的自动滚动之后才挂载，必须主动滚入可视区，
  // 否则长回复时脚注会落在可视区下方，用户「看不到溯源信息」。
  try { footer.scrollIntoView({ block: "nearest" }); } catch (_) {}
  console.log("[chat] 溯源脚注已挂载 · level=", report ? report.level : (opts.fallback ? "fallback" : opts.error ? "error" : "?"), " sources=", report ? report.sourceCount : 0);
 } catch (e) {
  // 任何意外都不应让溯源信息彻底消失：降级为最小可见脚注 + 控制台报错
  console.error("[chat] 溯源脚注挂载失败", e);
  try {
    const f = document.createElement("div");
    f.className = "chat-source-footer";
    f.textContent = "来源与依据：挂载异常，详见控制台。";
    wrap.appendChild(f);
  } catch (_) {}
 }
}

export function useChatController() {
  // —— 过程可视化状态（最小侵入：仅这一份 React 状态，抽屉是唯一消费者）——
  const [trace, setTrace] = useState(null);
  const traceRef = useRef(trace);
  useEffect(() => { traceRef.current = trace; }, [trace]);
  const [traceOpen, setTraceOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);   // 面板开合由 React 状态驱动，避免重渲染把 className 写回导致关闭失效
  // —— AI 主动给出的"行动项"：终态文本命中关键词 → 在 ChatMessages 下发挂一个 inline 按钮；
  //    用户点了 → 弹 TravelWizard + 自动 clearPendingAction；用户发了任何 user 消息 → 也自动 clear。
  //    null = 不显示。设计原则：不写死常显入口，按对话上下文自适应出现/消失。
  const [pendingAction, setPendingAction] = useState(null);
  const clearPendingAction = () => setPendingAction(null);
  const closeTrace = () => setTraceOpen(false);
  const toggleTrace = () => setTraceOpen((v) => !v);   // 一键显示/隐藏 5 个对话流浮层

  useEffect(() => {
    "use strict";

    const CONFIG = {
      typingMinMs: 500,
      typingMaxMs: 1300,
      maxChars: 2000,
      storageKey: "cyber-chat-history-v1",
    };
    const OUTPUT_BURST_MS = 900;            // 与 viz 脚本 OUTPUT_BURST(0.9s) 对应

    // —— 出行/规划意图关键词：AI 终态文本命中 → 在 ChatMessages 下发挂一个 inline 按钮（不写死常显）。
    //    命中后按钮自然出现在最新一条 AI 回复下方；用户点选或发任意消息后即消失。
    const TRAVEL_INTENT_RE =
      /(周末出行|周末两天|周末游|出行方案|出行规划|周末规划|偏好类型|出行半径|所在城市[／/].*区县|所在城市.*区县|出行属性)/;
    const setTravelAction = () =>
      setPendingAction({
        kind: "travel-wizard",
        label: "🧭 让我帮你规划周末出行",
        key: Date.now(),
      });

    const panel = document.getElementById("chatPanel");
    const openBtn = document.getElementById("openChat");
    const closeBtn = document.getElementById("closeChat");
    const clearBtn = document.getElementById("clearChat");
    const messagesEl = document.getElementById("chatMessages");
    const form = document.getElementById("chatComposer");
    const input = document.getElementById("chatInput");
    const sendBtn = document.getElementById("chatSend");

    const state = { history: [], busy: false };

    // ============ MCP 工具调用（Agent 能力 · 第一期 fetch，详见 MCP-INTEGRATION-PLAN.md） ============
    // 浏览器不直接连接 MCP 服务器（无法 spawn stdio / 持有凭据），而是经同源 /api/mcp
    // 代理到 Node 侧 MCP Relay。下面只持有客户端与缓存，编排逻辑在 handleSend 内。
    const mcpClient = new MCPClient(MODEL_CONFIG.mcpRelay);
    let cachedOpenAITools = null;   // OpenAI function 格式（带缓存，避免每轮请求）
    let cachedToolsFlat = null;     // 扁平 MCP tools（带 server 字段，用于 trace 展示）

    // 拉取并缓存可用工具；失败或空结果不缓存，便于 Relay 恢复后下次重试
    async function getTools() {
      if (!MODEL_CONFIG.toolsEnabled || !MODEL_CONFIG.supportsTools) return [];
      if (cachedOpenAITools) return cachedOpenAITools;
      try {
        const flat = await mcpClient.listTools();
        if (Array.isArray(flat) && flat.length) {
          cachedToolsFlat = flat;
          cachedOpenAITools = MCPClient.toOpenAITools(flat);
          return cachedOpenAITools;
        }
        return [];
      } catch (e) {
        console.warn("[mcp] 拉取工具失败，本轮降级为无工具对话：", (e && e.message) || e);
        return [];
      }
    }

    // 把工具调用事件同步进 trace（供 ChatTraceDrawer「06 工具调用」段渲染）
    function traceToolEvents(ev) {
      setTrace((prev) => {
        if (!prev || !prev.mcp) return prev;
        const mcp = { ...prev.mcp, invocations: prev.mcp.invocations ? [...prev.mcp.invocations] : [] };
        if (ev.type === "assistant_toolcalls") {
          mcp.status = "running";
        } else if (ev.type === "tool") {
          const inv = ev.invocation;
          const server = cachedToolsFlat
            ? (cachedToolsFlat.find((t) => t.name === inv.name) || {}).server || ""
            : "";
          mcp.invocations.push({ ...inv, server });
        } else if (ev.type === "final") {
          if (mcp.status === "running") mcp.status = "ok";
        } else if (ev.type === "error") {
          mcp.status = "error";
        }
        return { ...prev, mcp };
      });
    }

    // ============ 可拖拽 / 可缩放（DialogController） ============
    const MIN_W = 320, MIN_H = 240;
    const dragHandle = document.getElementById("chatDragHandle");
    const resizeHandles = panel ? panel.querySelectorAll(".resize-handle") : [];

    // --- 边界约束 ---
    function clampRect(r) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.max(MIN_W, Math.min(r.w || panel.offsetWidth, vw - 16));
      const h = Math.max(MIN_H, Math.min(r.h || panel.offsetHeight, vh - 16));
      const x = Math.max(0, Math.min(r.x || panel.offsetLeft, vw - w));
      const y = Math.max(0, Math.min(r.y || panel.offsetTop, vh - h));
      return { x, y, w, h };
    }
    function applyRect(r) {
      if (!panel) return;
      const c = clampRect(r);
      panel.style.left = c.x + "px";
      panel.style.top = c.y + "px";
      panel.style.width = c.w + "px";
      panel.style.height = c.h + "px";
    }
    function getRect() {
      if (!panel) return { x: 0, y: 0, w: 620, h: 480 };
      const r = panel.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    // --- 默认几何（不持久化：每次刷新回归默认坐标与尺寸） ---
    function defaultRect() {
      // 默认位置固定为 (1300, 80)；尺寸仍随视口收敛，避免极小窗口溢出。
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(510, Math.max(320, vw - 32));
      const h = Math.min(700, Math.max(360, vh - 154));
      return { x: 1300, y: 80, w, h };
    }

    // --- 拖拽（DragController）---
    let drag = null;
    function onDragStart(e) {
      if (!panel) return;
      if (e.target.closest(".chat-close, .chat-clear, .chat-trace, .chat-image, .dev-label")) return;  // 关闭/清空/对话流/配图按钮与 ID 标签不触发拖拽
      if (e.button !== undefined && e.button !== 0) return;   // 仅左键
      drag = { px: e.clientX, py: e.clientY, rect: getRect() };
      panel.classList.add("dragging");
      dragHandle.setPointerCapture(e.pointerId);
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragEnd, { once: true });
      e.preventDefault();
    }
    function onDragMove(e) {
      if (!drag || !panel) return;
      applyRect({
        x: drag.rect.x + (e.clientX - drag.px),
        y: drag.rect.y + (e.clientY - drag.py),
        w: drag.rect.w, h: drag.rect.h,
      });
    }
    function onDragEnd() {
      drag = null;
      if (panel) panel.classList.remove("dragging");
      window.removeEventListener("pointermove", onDragMove);
    }

    // --- 缩放（ResizeController）---
    let rz = null;
    function onResizeStart(e) {
      if (!panel) return;
      rz = { px: e.clientX, py: e.clientY, rect: getRect(),
        dir: e.currentTarget.getAttribute("data-dir") };
      panel.classList.add("resizing");
      e.currentTarget.setPointerCapture(e.pointerId);
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", onResizeEnd, { once: true });
      e.preventDefault(); e.stopPropagation();
    }
    function onResizeMove(e) {
      if (!rz || !panel) return;
      const dx = e.clientX - rz.px, dy = e.clientY - rz.py;
      let { x, y, w, h } = rz.rect;
      const d = rz.dir;
      if (d.includes("e")) w = rz.rect.w + dx;
      if (d.includes("s")) h = rz.rect.h + dy;
      if (d.includes("w")) { w = rz.rect.w - dx; x = rz.rect.x + dx; }
      if (d.includes("n")) { h = rz.rect.h - dy; y = rz.rect.y + dy; }
      applyRect({ x, y, w, h });
    }
    function onResizeEnd() {
      rz = null;
      if (panel) panel.classList.remove("resizing");
      window.removeEventListener("pointermove", onResizeMove);
    }

    // --- 初始化几何 + 绑定事件（含移动端降级）---
    function isTouchDevice() {
      return window.matchMedia("(hover: none) and (pointer: coarse)").matches
        || window.innerWidth <= 640;
    }
    function initLayout() {
      applyRect(defaultRect());
    }

    // 桌面端：拖拽/缩放仅在 dev-mode（显示组件ID）时启用，退出即锁定
    function enablePanelDrag() {
      if (!panel || isTouchDevice()) return;
      if (dragHandle) {
        dragHandle.removeEventListener("pointerdown", onDragStart);
        dragHandle.addEventListener("pointerdown", onDragStart);
      }
      resizeHandles.forEach(function (h) {
        h.removeEventListener("pointerdown", onResizeStart);
        h.addEventListener("pointerdown", onResizeStart);
      });
      panel.classList.add("draggable");
    }
    function disablePanelDrag() {
      if (dragHandle) dragHandle.removeEventListener("pointerdown", onDragStart);
      resizeHandles.forEach(function (h) { h.removeEventListener("pointerdown", onResizeStart); });
      panel.classList.remove("draggable");
    }
    function syncPanelDragMode() {
      if (isDevMode()) enablePanelDrag(); else disablePanelDrag();
    }

    function bindLayoutEvents() {
      if (!panel) return;
      if (isTouchDevice()) {
        // 移动端降级：清除内联尺寸，回归居中静态布局，隐藏手柄
        panel.style.left = panel.style.top = panel.style.width = panel.style.height = "";
        panel.classList.add("static");
        return;
      }
      // 桌面端：依据 dev-mode 决定可否拖动，并订阅切换事件动态同步
      syncPanelDragMode();
      onDevModeChange(syncPanelDragMode);
      // 视口变化时重新约束面板位置/尺寸，防止越界
      window.addEventListener("resize", function () { applyRect(getRect()); });
    }

    const fmtTime = (ts) =>
      new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

    // localStorage 容错（隐私模式可能不可用）
    function loadHistory() {
      try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) state.history = parsed;
        }
      } catch (e) { /* 忽略 */ }
    }
    function saveHistory() {
      try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.history)); }
      catch (e) { /* 忽略 */ }
    }

    function scrollBottom() {
      requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    }

    // ============ 对话位置自动地图标注 → MapWindow 独立浮窗（事件驱动） ============
    // 两条坐标来源：① 文本抽取（extractLocations）→ maps_geo；② AI tool-loop 调 maps_* 返回。
    // 输出目标：派发 CustomEvent 到 MapWindow（Portal 浮窗），不再内联插入 DOM。

    // 已派发的坐标 / query 去重（避免同一条消息、或用户+AI 重复推送同一地点）
    const dispatchedCoords = new Set();
    const dispatchedQueries = new Set();
    const queryToId = new Map(); // normalized query -> card id，用于更新旧卡片

    // 检测前端是否配了 Key B（高德 JS API），决定 MapWindow 渲染真实地图 or 降级文本
    function hasAmapJsKey() { return !!import.meta.env?.VITE_AMAP_JS_KEY; }

    // 来源①+② 统一入口：拿到 markers/route 后推送到 MapWindow
    function pushMapToWindow(id, label, markers, route, query = "") {
      const coordKey = (markers || []).map((m) => m.lng.toFixed(4) + "," + m.lat.toFixed(4)).join("|");
      const normQuery = String(query).trim().toLowerCase();
      if (!coordKey && !route) return;

      // 同 query 已存在 → 更新旧卡片数据，避免同一地点在用户消息和 AI 工具调用里各出现一次
      if (normQuery && dispatchedQueries.has(normQuery)) {
        const existingId = queryToId.get(normQuery);
        if (existingId) {
          window.dispatchEvent(new CustomEvent("jarvis:map-ready", {
            detail: { id: existingId, label, markers, route, hasJsKey: hasAmapJsKey() },
          }));
        }
        return;
      }
      // 同坐标已推送过 → 跳过
      if (coordKey && dispatchedCoords.has(coordKey)) return;

      if (normQuery) {
        dispatchedQueries.add(normQuery);
        queryToId.set(normQuery, id);
      }
      if (coordKey) dispatchedCoords.add(coordKey);

      window.dispatchEvent(new CustomEvent("jarvis:map-start", { detail: { id, label, hasJsKey: hasAmapJsKey() } }));
      // 微任务延迟让 MapWindow 先渲染 loading 卡片，再填数据
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("jarvis:map-ready", {
          detail: { id, label, markers, route, hasJsKey: hasAmapJsKey() },
        }));
      }, 50);
    }

    // 来源①：对消息文本抽取位置 → maps_geo → 每张地图一个地点（标题用真实地名）
    // opts.ctx 可选：对话历史数组（用于 POI 上下文消歧，例如 ctx 含"上海"时"东方明珠"会升级成"上海东方明珠"）
    // opts.mode 可选："normal"（默认）/ "strict"。strict 端挡掉 AI 描述型提及，避免
    //   "陆家嘴三件套" 这种介绍型文本被误推 3 张地图卡片、且 text_search 在无 city 参数下
    //   跨省匹配命中天津/邵阳同名点（marker 飘到外省 → setFitView 把视口扯到全国）。
    async function maybeShowMap(text, role, opts = {}) {
      try {
        // 拼最近几轮历史做 ctx，避免单条文本"东方明珠"无城市前缀 → maps_geo 命中邵阳同名点。
        // 限 3 条 / 单条 400 字防止 ctx 把 POI 过度泛化（误合并不该合并的远地城市）。
        const recentCtx = (state.history || [])
          .slice(-3)
          .map((h) => String(h.text || "").slice(0, 400));
        const mode = opts.mode || "normal";
        const extractor = mode === "strict" ? extractLocationsStrict : extractLocations;
        const cands = extractor(text, { ctx: recentCtx });
        if (!cands.length) return;

        // 上下文关联：text + 历史里的 KNOWN_CITY 哪个出现最多 → 兜底 cityArg（防止
        // query 不以 CITY 开头如"陆家嘴金融中心区" 时 text_search 跨省误匹配）。
        const cityCorpus = text + " " + recentCtx.join(" ");
        const contextCity = guessContextCity(cityCorpus);

        for (const c of cands) {
          try {
            // 两段式精确查询：
            // ① maps_text_search(keywords, city) → 取第一条 POI 的 id（按相关度排序，知名 POI 排第一）
            // ② maps_search_detail(id) → 拿精确 location（GCJ-02）
            // 失败再回退到 maps_geo（处理非 POI 类地址，如"杭州市西湖区文一路 100 号"等纯地址）。
            let mk = null;
            let detailQuery = c.query;
            // 从 query 里识别 KNOWN_CITY 前缀作为 city 参数；无前缀则尝试 contextCity 兜底。
            let cityArg = null;
            for (const city of KNOWN_CITY) {
              if (c.query.startsWith(city)) { cityArg = city; break; }
            }
            if (!cityArg && contextCity) cityArg = contextCity;
            const tsRes = await mcpClient.callTool("maps_text_search", {
              keywords: c.query,
              ...(cityArg ? { city: cityArg } : {}),
            });
            if (!tsRes.isError) {
              const top = parseTextSearch(tsRes.content);
              if (top && top.id) {
                const detRes = await mcpClient.callTool("maps_search_detail", { id: top.id });
                if (!detRes.isError) {
                  const det = parseSearchDetail(detRes.content);
                  if (det) {
                    mk = det;
                    detailQuery = top.id;
                  }
                }
              }
            }
            // 回退到 maps_geo
            if (!mk) {
              const r = await mcpClient.callTool("maps_geo", { address: c.query });
              if (!r.isError) {
                mk = parseGeoMarker(r.content, c.text);
              }
            }
            // 安全网：距离校验。如果 text 或 ctx 里包含 KNOWN_CITY 而返回坐标离该
            // 城市中心 > 阈值（大城市 80km / 中城市 60km），视为跨省同名误匹配，丢弃。
            // 例：text="陆家嘴三件套" + ctx="上海..." → 期望城市=上海；text_search 命中
            //      天津"陆家嘴金融中心"（117.16,39.14）→ 距上海 1091km → 丢弃。
            const expectedCity = cityArg || contextCity;
            if (mk && expectedCity) {
              const v = validateAgainstCity(mk, expectedCity);
              if (!v.ok) {
                console.warn(
                  "[map] 跨省误匹配已丢弃：",
                  c.query, "→", mk.label, "(" + mk.lng + "," + mk.lat + ")",
                  "期望城市=" + expectedCity,
                  v.reason
                );
                mk = null;
              }
            }
            if (mk) {
              const mapId = "map-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
              pushMapToWindow(mapId, mk.label || c.text || "位置标注", [mk], null, detailQuery);
            }
          } catch (e) { /* 单条地理编码失败忽略 */ }
        }
      } catch (e) {
        console.warn("[map] maybeShowMap 失败：", e && e.message);
      }
    }

    function appendMessage(role, text, time) {
      const ts = time || Date.now();
      // 归一化显示角色：历史持久化用的是 "assistant"，但气泡样式/复制按钮都按 "ai" 挂载；
      // 不归一化会导致重载后的 AI 历史气泡既无 cyan 气泡样式、也无复制按钮（即“历史不能复制”的根因）。
      const cls = role === "user" ? "user" : "ai";
      const wrap = document.createElement("div");
      wrap.className = "chat-msg " + cls;

      const who = document.createElement("div");
      who.className = "who";
      who.textContent = (role === "user" ? "YOU · " : "AI · ") + fmtTime(ts);

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      const textNode = document.createElement("span");     // 独立文本节点：流式更新只改它，不会误删复制按钮
      textNode.className = "bubble-text";
      // 渲染前脱敏本地路径 / 图片引用（@image#N / <image_local_path>）；持久化用的也是 sanitized 后的同一份，
      // 重载历史时直接走 appendMessage 不需要再过滤一次。
      const sanitized = (cls === "ai") ? sanitizeImageRefs(text || "") : (text || "");
      textNode.textContent = sanitized;                     // textContent 防 XSS
      bubble.appendChild(textNode);

      wrap.appendChild(who);
      wrap.appendChild(bubble);
      // 一键复制：AI 回复与用户发送内容都支持（历史/新发一致）
      attachCopyButton(bubble, cls === "user" ? "复制内容" : "复制回复");
      // AI 消息中的 Markdown 链接与裸 URL 渲染为可点击 <a>
      if (cls === "ai") renderInlineLinks(bubble, text);
      messagesEl.appendChild(wrap);

      state.history.push({ role, text: sanitized, time: ts });
      scrollBottom();
    }

    // 富结果消息：气泡内容由 renderMovieResults 经 escapeHtml 构造（安全），
    // 历史持久化存纯文本（bubble.textContent），重载后回退为纯文本展示。
    function appendRichMessage(role, html) {
      const cls = role === "user" ? "user" : "ai";
      const wrap = document.createElement("div");
      wrap.className = "chat-msg " + cls;

      const who = document.createElement("div");
      who.className = "who";
      who.textContent = (role === "user" ? "YOU · " : "AI · ") + fmtTime(Date.now());

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = html;
      wrap.appendChild(who);
      wrap.appendChild(bubble);
      // 复制按钮抓的是 textContent（纯文本）；AI 结果与用户内容都支持
      attachCopyButton(bubble, cls === "user" ? "复制内容" : "复制回复");
      messagesEl.appendChild(wrap);

      state.history.push({ role, text: bubble.textContent, time: Date.now() });
      scrollBottom();
      return bubble;
    }

    // 流式气泡：先建空气泡，后续逐块填充；textContent 防 XSS
    function createStreamingBubble() {
      const wrap = document.createElement("div");
      wrap.className = "chat-msg ai chat-streaming";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = "AI · " + fmtTime(Date.now());
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      const textNode = document.createElement("span");     // 同 appendMessage：流式增量只改文本节点，保住复制按钮
      textNode.className = "bubble-text";
      bubble.appendChild(textNode);
      wrap.appendChild(who);
      wrap.appendChild(bubble);
      attachCopyButton(bubble);                  // 流式回复同样支持复制
      messagesEl.appendChild(wrap);
      scrollBottom();
      return {
        el: wrap,
        // 流式每 chunk 渲染前都过 sanitize（idempotent，无副作用），避免中途出现一帧 @image#N:"..." 或本地路径
        set: (t) => { textNode.textContent = sanitizeImageRefs(t || ""); scrollBottom(); },
        finalize: (t) => {
          const finalText = sanitizeImageRefs(t || "");
          textNode.textContent = finalText;
          renderInlineLinks(bubble, finalText);          // 把 [文本](url) 与裸 URL 渲染为可点击链接
          wrap.classList.remove("chat-streaming");
          scrollBottom();
        },
      };
    }

    function showTyping() {
      if (window.CyberFx) window.CyberFx.thinking();   // 进入“思考中”页面特效
      const wrap = document.createElement("div");
      wrap.className = "chat-msg ai chat-typing";
      wrap.innerHTML =
        '<div class="who">AI</div>' +
        '<div class="bubble"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>';
      messagesEl.appendChild(wrap);
      scrollBottom();
      return wrap;
    }

    // —— 影视搜索独立窗口：检索过程时间线 + 工具调用 + 已核验结果 ——
    let mswAbort = null;

    function ensureMovieSearchWindow() {
      let root = document.getElementById("movieSearchWindow");
      if (root) return root;
      root = document.createElement("div");
      root.id = "movieSearchWindow";
      root.className = "msw";
      root.innerHTML =
        '<div class="msw-panel" role="dialog" aria-label="影视搜索" data-dev-id="movie-search-window">' +
          '<div class="msw-head">' +
            '<div class="msw-title">🔍 影视搜索 · <b id="mswQuery"></b></div>' +
            '<span class="msw-status" id="mswStatus">就绪</span>' +
            '<button class="msw-close" id="mswClose" type="button" aria-label="关闭">✕</button>' +
          '</div>' +
          '<div class="msw-discovery" id="mswDiscovery"></div>' +
          '<div class="msw-body">' +
            '<div class="msw-left">' +
              '<div class="msw-sect">检索过程 · 工具调用</div>' +
              '<ol class="msw-timeline" id="mswTimeline"></ol>' +
              '<div class="msw-verify" id="mswVerify"></div>' +
            '</div>' +
            '<div class="msw-right" id="mswResults"></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(root);
      root.querySelector("#mswClose").addEventListener("click", closeMovieSearchWindow);
      makeDraggable(root.querySelector(".msw-panel"), root.querySelector(".msw-head"));
      return root;

      // 让弹层像真实窗口一样可拖拽（拖动标题栏切换为 left/top 绝对定位）
      function makeDraggable(panel, handle) {
        if (panel.dataset.drag === "1") return;
        panel.dataset.drag = "1";
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        handle.addEventListener("mousedown", (e) => {
          if (e.target.closest(".msw-close")) return; // 点关闭按钮不触发拖拽
          dragging = true;
          const r = panel.getBoundingClientRect();
          panel.style.left = r.left + "px";
          panel.style.top = r.top + "px";
          panel.style.transform = "none"; // 脱离居中 transform，改用 left/top
          sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
          document.body.style.userSelect = "none";
          e.preventDefault();
        });
        window.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          const w = panel.offsetWidth, h = panel.offsetHeight;
          let nx = ox + (e.clientX - sx);
          let ny = oy + (e.clientY - sy);
          nx = Math.max(4, Math.min(nx, window.innerWidth - w - 4));
          ny = Math.max(4, Math.min(ny, window.innerHeight - h - 4));
          panel.style.left = nx + "px";
          panel.style.top = ny + "px";
        });
        window.addEventListener("mouseup", () => {
          if (dragging) { dragging = false; document.body.style.userSelect = ""; }
        });
      }
    }

    function closeMovieSearchWindow() {
      const root = document.getElementById("movieSearchWindow");
      if (root) root.classList.remove("msw-open");
      if (mswAbort) { try { mswAbort.abort(); } catch (e) { /* ignore */ } mswAbort = null; }
    }

    // 结果逐条淡入（在独立窗口内复用同一套 stagger 逻辑）
    function revealIn(root) {
      if (!root || !root.classList.contains("ms-revealing")) return;
      const STAGGER = 45, GROUP_GAP = 140;
      let t = 0;
      const targets = [];
      root.querySelectorAll(".ms-group").forEach((g) => {
        const head = g.querySelector(".ms-gtitle");
        const note = g.querySelector(".ms-gnote");
        if (head) targets.push({ el: head, at: t });
        if (note) targets.push({ el: note, at: t + 20 });
        const items = g.querySelectorAll(".ms-item");
        items.forEach((it, i) => targets.push({ el: it, at: t + 60 + i * STAGGER }));
        t += 60 + items.length * STAGGER + GROUP_GAP;
      });
      root.querySelectorAll(".ms-tips, .ms-warns").forEach((el) => { targets.push({ el, at: t }); t += 80; });
      if (!targets.length) { root.classList.remove("ms-revealing"); return; }
      let pending = targets.length;
      targets.forEach(({ el, at }) => {
        setTimeout(() => {
          el.classList.add("ms-show");
          if (--pending <= 0) root.classList.remove("ms-revealing");
        }, at);
      });
      setTimeout(() => {
        root.querySelectorAll(".ms-gtitle,.ms-gnote,.ms-item,.ms-tips,.ms-warns").forEach((el) => el.classList.add("ms-show"));
        root.classList.remove("ms-revealing");
      }, 4000);
    }

    function openMovieSearchWindow(query) {
      const root = ensureMovieSearchWindow();
      root.classList.add("msw-open");
      if (window.CyberFx) window.CyberFx.thinking();

      const qEl = root.querySelector("#mswQuery");
      if (qEl) qEl.textContent = query;
      const tl = root.querySelector("#mswTimeline");
      tl.innerHTML = "";
      const vf = root.querySelector("#mswVerify");
      vf.innerHTML = "";
      const res = root.querySelector("#mswResults");
      const statusEl = root.querySelector("#mswStatus");
      res.innerHTML = '<div class="msw-loading"><span class="mp-spin"></span> 正在初始化检索流水线…</div>';
      if (statusEl) statusEl.textContent = "初始化…";

      // —— 加法：顶部「影片发现」区（元数据卡片），失败不影响下方 Bing 结果 ——
      populateDiscovery(root.querySelector("#mswDiscovery"), query);

      const steps = new Map();
      const addTool = (ev) => {
        let li = steps.get(ev.id);
        if (!li) {
          li = document.createElement("li");
          li.className = "msw-step";
          li.innerHTML =
            '<span class="msw-dot msw-run"></span>' +
            '<div class="msw-step-body"><div class="msw-tool"></div><div class="msw-detail"></div></div>';
          tl.appendChild(li);
          steps.set(ev.id, li);
        }
        li.querySelector(".msw-tool").textContent = ev.name || ev.id;
        li.querySelector(".msw-detail").textContent = ev.detail || "";
        const dot = li.querySelector(".msw-dot");
        dot.className = "msw-dot " + (ev.status === "running" ? "msw-run"
          : ev.status === "warn" ? "msw-warn"
          : ev.status === "skip" ? "msw-skip" : "msw-ok");
        if (statusEl && ev.status === "running") statusEl.textContent = "检索中…";
      };
      const setVerify = (p) => {
        vf.innerHTML =
          '<div class="msw-vrow"><span class="mp-spin"></span> 已核验 <b>' + p.checked + "</b>/" + p.total +
          ' · <span class="vk-unknown">待确认 ' + p.unknown + "</span>" +
          ' · <span class="vk-exp">失效/过期 ' + p.expired + "</span>" +
          ' · <span class="vk-dead">访问失败 ' + p.dead + "</span></div>";
        if (statusEl) statusEl.textContent = "核验 " + p.checked + "/" + p.total;
      };
      const renderDone = (result) => {
        res.innerHTML = renderMovieResults(result);
        revealIn(res.querySelector(".movie-search"));
        const total = (result.groups || []).reduce((a, g) => a + (g.items ? g.items.length : 0), 0);
        if (statusEl) statusEl.textContent = "完成 · " + total + " 条";
        if (window.CyberFx) {
          window.CyberFx.output();
          setTimeout(() => { if (window.CyberFx) window.CyberFx.idle(); }, OUTPUT_BURST_MS);
        }
      };

      mswAbort = new AbortController();
      streamMovieSearch(query, mswAbort.signal, {
        onTool: addTool,
        onVerify: setVerify,
        onDone: renderDone,
        onError: async (msg) => {
          // 流式失败 → 回退普通 JSON 接口（含离线兜底）
          try {
            const fb = await searchMovies(query);
            addTool({ id: "fallback", name: "检索（非流式回退）", status: "warn", detail: msg || "" });
            renderDone(fb);
          } catch (e) {
            res.innerHTML = '<div class="msw-error">检索失败：' + escapeHtml((e && e.message) || msg || "未知错误") + "</div>";
            if (statusEl) statusEl.textContent = "失败";
            if (window.CyberFx) window.CyberFx.idle();
          }
        },
      });
    }

    // ---------- 构造请求消息（system + 最近 12 轮历史） ----------
    // 注意：chat-panel 并非频谱数据智能体，故 system 提示词不含任何实时音频/
    // 频谱描述，仅保留通用 AI 助手身份与语气约束。
    async function buildMessages(userText) {
      const base =
        "你是集成在一个赛博朋克风格界面中的 AI 助手「J.A.R.V.I.S.」。" +
        "请用简体中文回答，语气带科技感，简洁清晰、切中要点。" +
        FACTUALITY_DIRECTIVES;
      let content = base;
      // 主动召回：把和用户当前问题相关的长期记忆注入 system，使助手自带上下文
      let recall = { block: "", count: 0, entries: [], query: userText || "", enabled: true };
      try {
        recall = await recallMemories(userText || "");
        if (recall && recall.block) content = base + "\n\n" + recall.block;
      } catch (e) {
        /* 召回失败不影响主流程，退化为无记忆版本 */
      }
      const systemMsg = { role: "system", content };
      const historyMsgs = state.history.slice(-12).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
      const messages = [systemMsg, ...historyMsgs];
      return { systemMsg, historyMsgs, messages, recall };
    }

    // ---------- 真实大模型流式调用（LongCat · OpenAI 兼容 SSE） ----------
    async function streamLongCat(messages, tools, handlers) {
      const onContent = handlers && handlers.onContent;
      const onReasoning = handlers && handlers.onReasoning;
      const onToolCallDelta = handlers && handlers.onToolCallDelta;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), MODEL_CONFIG.timeoutMs);
      try {
        // 整组供应商切换：选中供应商决定 endpoint / apiKey / model
        const profile = providerManager.getActive();
        if (!profile || !profile.apiKey) {
          throw new Error(
            "未配置可用的供应商密钥（请在 .env 设置 VITE_LONGCAT_API_KEYS 或 VITE_QWEN_API_KEY）"
          );
        }
        const endpoint = profile.endpoint;
        const authKey = profile.apiKey;
        const model = profile.model;

        const headers = { "Content-Type": "application/json" };
        if (authKey) headers["Authorization"] = "Bearer " + authKey;
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages,
            max_tokens: MODEL_CONFIG.maxTokens,
            temperature: MODEL_CONFIG.temperature,
            stream: true,
            // 仅在确有可用工具时附带 tools；否则走普通对话（降级/无工具场景）
            ...(tools && tools.length ? { tools } : {}),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let detail = "";
          try { const j = await res.json(); detail = (j && j.error && j.error.message) || JSON.stringify(j); } catch (e) { /* ignore */ }
          throw new Error("HTTP " + res.status + (detail ? " · " + detail : ""));
        }
        if (!res.body || !res.body.getReader) {
          throw new Error("当前环境不支持流式读取（无 ReadableStream）");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let carry = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const parsed = parseSSEChunk(chunk, carry);
          carry = parsed.carry;
          for (const ev of parsed.events) {
            let json;
            try { json = JSON.parse(ev); } catch (e) { continue; }
            const choice = json.choices && json.choices[0];
            if (!choice) continue;
            const delta = choice.delta || {};
            if (delta.content) onContent && onContent(String(delta.content));
            if (delta.reasoning_content) onReasoning && onReasoning(String(delta.reasoning_content));
            // tool_calls 流式碎片：逐片交给累加器重组（重组结果在请求结束时汇总）
            if (delta.tool_calls) onToolCallDelta && onToolCallDelta(delta.tool_calls);
          }
          if (parsed.done) break;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    function setBusy(b) {
      state.busy = b;
      sendBtn.disabled = b || input.value.trim() === "";
      if (clearBtn) clearBtn.disabled = b || state.history.length === 0;
      input.disabled = b;
    }

    // —— 影视搜索指令：解析 "@影视搜索 <名称>" → 分层检索 → 富结果渲染 ——
    // 返回 true 表示已处理（含空名称提示），调用方应跳过普通对话；false 表示非本指令。
    async function runMovieSearchCommand(raw) {
      const parsed = parseCommand(raw);
      if (!parsed.matched) return false;

      // 指令正确但缺名称：仅礼貌提示（不二次追问，符合 v4.1 规则）
      if (parsed.error === "empty" || !parsed.query) {
        appendMessage(
          "ai",
          "请输入要检索的影视名称，例如：" + MOVIE_SEARCH_PREFIX + " 流浪地球"
        );
        return true;
      }

      // 独立窗口展示：检索过程 / 工具调用时间线 + 已核验结果
      openMovieSearchWindow(parsed.query);
      return true;
    }

    async function handleSend(overrideText) {
      console.log("[chat] handleSend called", { override: overrideText != null, busy: state.busy });
      const raw = (overrideText != null ? String(overrideText) : input.value).trim();
      if (!raw) { console.log("[chat] handleSend early: empty raw"); return; }
      if (state.busy) { console.log("[chat] handleSend early: busy"); return; }
      if (raw.length > CONFIG.maxChars) {
        appendMessage("ai", "消息过长，请控制在 " + CONFIG.maxChars + " 字以内。");
        return;
      }
      appendMessage("user", raw);
      // 用户发了任意一条消息 → 之前的"AI 行动项"请求已被覆盖/失效，inline 按钮自动消失
      clearPendingAction();
      // 来源①：用户输入含位置 → 自动地图标注（fire-and-forget，不阻塞发送）
      maybeShowMap(raw, "user").catch(() => {});
      input.value = "";
      autoGrow();
      updateSend();
      setBusy(true);
      // 会话开始：通知 MCP 面板清空上一轮的「已用工具」呼吸灯集合
      window.dispatchEvent(new CustomEvent("jarvis:chat-session-start"));

      // —— 影视搜索指令拦截：严格匹配 "@影视搜索 <名称>" ——
      // 命中则跳过 LLM / trace，直接走检索流程；未命中（matched=false）回落普通对话。
      const movieHandled = await runMovieSearchCommand(raw);
      if (movieHandled) {
        setBusy(false);
        input.focus();
        return;
      }

      const typing = showTyping();            // 首个 token 到达前显示思考点

      // ---- 构造请求上下文 + 初始 trace（对话发起瞬间） ----
      const built = await buildMessages(raw);
      const activeProfile = providerManager.getActive();
      const traceInit = {
        status: "sending",
        sentAt: Date.now(),
        model: (activeProfile || {}).model || "—",
        mode: "longcat",
        key: activeProfile ? { id: activeProfile.id, label: activeProfile.label } : null,
        context: {
          history: built.historyMsgs,
        },
        prompt: {
          system: built.systemMsg.content,
          messages: built.messages,
        },
        reply: { text: "", reasoning: "", done: false },
        // MCP 工具调用区：enabled 表示开关打开；status 随 tool-loop 演进
        mcp: {
          enabled: MODEL_CONFIG.toolsEnabled && MODEL_CONFIG.supportsTools,
          status: "pending",   // pending | running | ok | unavailable | error
          toolsCount: 0,
          invocations: [],
        },
        // 内容校验（溯源 / 可信度）：流式期间实时捕获来源，终态定稿完整报告
        verification: {
          status: "verifying",   // verifying | done | fallback | error
          sources: [],
          sentAt: Date.now(),
        },
        // 主动记忆召回：本轮对话构造 prompt 时，按用户问题检索到的长期记忆
        memory: {
          enabled: !!(built.recall && built.recall.enabled),
          query: (built.recall && built.recall.query) || "",
          count: (built.recall && built.recall.count) || 0,
          entries: (built.recall && built.recall.entries) || [],
          status: !built.recall || !built.recall.enabled
            ? "disabled"
            : (built.recall.count || 0) > 0
              ? "hit"
              : "empty",
        },
      };
      setTrace(traceInit);
      setTraceOpen(true);                     // 对话发起瞬间自动弹出浮层

      // ---- 流式渲染本地状态 ----
      let answer = "";
      let reasoning = "";
      let started = false;
      let bubble = null;
      let flushScheduled = false;

      function beginStream() {
        if (started) return;
        started = true;
        if (typing && typing.remove) typing.remove();
        bubble = createStreamingBubble();
        setTrace((prev) => (prev ? { ...prev, status: "streaming" } : prev));
      }
      function flushTrace() {
        flushScheduled = false;
        setTrace((prev) =>
          prev
            ? {
                ...prev,
                reply: { ...prev.reply, text: answer, reasoning },
                // 流式期间实时抽取已出现的来源，让「校验中」可见
                verification: prev.verification
                  ? { ...prev.verification, sources: extractLiveSources(answer) }
                  : prev.verification,
              }
            : prev);
      }
      function scheduleTraceFlush() {
        if (flushScheduled) return;
        flushScheduled = true;
        requestAnimationFrame(flushTrace);
      }

      // —— MCP tool-loop 编排所需的两次回调（闭包捕获本轮 answer/bubble 等） ——
      // 单次 LLM 请求：流式合并 content / reasoning / tool_calls 后返回给 agentLoop。
      async function requestLLM(messages, tools) {
        answer = ""; reasoning = "";            // 每轮重置，避免跨轮累积
        const acc = new ToolCallAccumulator();
        let err = null;
        try {
          await streamLongCat(messages, tools, {
            onContent: (d) => { beginStream(); answer += d; if (bubble) bubble.set(answer); scheduleTraceFlush(); },
            onReasoning: (d) => { beginStream(); reasoning += d; scheduleTraceFlush(); },
            onToolCallDelta: (tc) => { acc.add(tc); beginStream(); scheduleTraceFlush(); },
          });
        } catch (e) {
          err = (e && e.message) ? e.message : "未知错误";
        }
        return { content: answer, reasoning, toolCalls: acc.toMessageToolCalls(), error: err };
      }

      // 执行单个 MCP 工具（经 Relay）；错误向上抛，由 agentLoop 兜底回填
      async function executeTool(name, args, callId) {
        window.dispatchEvent(new CustomEvent("jarvis:mcp-tool-start", { detail: { name } }));
        try {
          const r = await mcpClient.callTool(name, args);
          // 来源②：AI tool-loop 调 maps_* 工具 → 推送 MapWindow 独立浮窗
          if (!r.isError) {
            if (name === "maps_geo") {
              const mk = parseGeoMarker(r.content, args && args.address);
              if (mk) pushMapToWindow(
                "map-tool-" + (callId || Date.now()),
                args?.address || "位置标注",
                [mk], null,
                args?.address || ""
              );
            } else if (/^maps_direction_/.test(name)) {
              const rt = parseRoute(r.content);
              if (rt) pushMapToWindow(
                "map-route-" + (callId || Date.now()),
                "路线标注",
                rt.markers, rt
              );
            }
          }
          return { content: r.content, isError: r.isError };
        } finally {
          window.dispatchEvent(new CustomEvent("jarvis:mcp-tool-end", { detail: { name } }));
        }
      }

      try {
        // —— Agent tool-loop：检测 tool_calls → 调工具 → 回填 → 再请求（≤N 次） ——
        const result = await runAgentLoop({
          messages: built.messages,
          getTools,
          requestLLM,
          executeTool,
          maxIterations: MODEL_CONFIG.maxToolIterations,
          onEvent: traceToolEvents,
        });

        if (result.llmFailed) {
          // LLM 请求失败：复用原兜底逻辑（与下方 catch 一致）
          throw new Error(result.llmError || "LLM 请求失败");
        }

        if (!started) beginStream();          // 极少见：无任何增量也需定稿
        // 终态校验：把 AI 回复转成可追溯报告（可信度 / 来源 / 时效边界）
        const vReport = verifyAnswer({
          text: result.finalContent,
          model: (activeProfile || {}).model,
          sentAt: traceInit.sentAt,
        });
        if (bubble) bubble.finalize(result.finalContent);
        // 自动打开网页：AI 终态含 URL 时，直接把全部提取到的网址派发开窗（与「点击链接」行为一致，不再做可达性探测以免误丢弃合法网址）
        const _urls = extractUrls(result.finalContent);
        if (_urls.length) dispatchOpenUrls(_urls, { auto: true });
        // 气泡溯源脚注：把可信度 / 来源 / 时效边界直接挂到回复下方，输出可溯源、可验证
        const fbTarget = (bubble && bubble.el) ? bubble.el : (messagesEl && messagesEl.lastElementChild);
        const toolReads = extractMemoryToolReads((traceRef.current && traceRef.current.mcp && traceRef.current.mcp.invocations) || []);
        attachProvenanceFooter(fbTarget, vReport, { recall: built.recall, toolReads });
        // 来源①：AI 终态文本含位置 → 自动地图标注
        // mode: 'strict' 过滤掉 AI 描述型提及（如"陆家嘴三件套"、"东方明珠广播电视塔"作为
        // 知识点描述，不是用户问"地图上的地点"）。这些 POI 名称会让 maps_text_search 在无
        // city 约束下跨省匹配命中天津/邵阳同名点，setFitView 把地图视口扯到全国。
        maybeShowMap(result.finalContent, "ai", { mode: "strict" }).catch(() => {});
        // 出行/规划意图识别：AI 终态文本若问"请补充定位参数/偏好/半径" → 在回复下方挂一个临时 inline 行动按钮
        // 不写死常显入口，按对话上下文自适应出现/消失。
        if (TRAVEL_INTENT_RE.test(result.finalContent)) setTravelAction();
        // 历史持久化前过 sanitize：避免重载后历史里仍含 @image#N:"..." / Windows 路径
        state.history.push({ role: "assistant", text: sanitizeImageRefs(result.finalContent), time: Date.now() });
        saveHistory();
        runImagePipeline(result.finalContent);   // 终态触发：把最终回答额外生成一张配图（旁路，不影响文本）
        // 自动记忆获取（旁路，fire-and-forget）：本轮对话结束后提炼用户长期事实写入 memory
        runAutoMemory(raw, result.finalContent).catch(() => {});
        setTrace((prev) => (prev ? {
          ...prev, status: "done",
          mode: result.degraded ? "longcat-no-mcp" : "longcat",
          reply: { ...prev.reply, text: result.finalContent, reasoning: result.finalReasoning, done: true },
          mcp: {
            ...prev.mcp,
            status: result.degraded ? "unavailable" : (prev.mcp?.status || "ok"),
            toolsCount: cachedOpenAITools?.length || 0,
          },
          // 终态校验报告（status 切 done，附完整报告）
          verification: { ...vReport, status: "done" },
        } : prev));
        // 触发“内容输出”页面特效，并在爆发结束后回落到 idle
        if (window.CyberFx) {
          window.CyberFx.output();
          setTimeout(() => { if (window.CyberFx) window.CyberFx.idle(); }, OUTPUT_BURST_MS);
        }
      } catch (err) {
        if (typing && typing.remove) typing.remove();
        const reason = (err && err.message) ? err.message : "未知错误";
        // 显式报错，避免「静默回退本地模拟」让用户误以为已接真实模型
        console.error(
          "[chat] LongCat 接口调用失败，已回退本地模拟回复：" +
          reason + "\n（请检查网络 / 代理 / 密钥；可在 trace 浮层查看状态）"
        );
        let finalText;
        let replyKind = "error";
        if (MODEL_CONFIG.fallbackToLocal) {
          replyKind = "fallback";
          // 接口失败回退：中性本地文案（不与频谱数据绑定）
          finalText = "（本地模拟回复）当前无法连接 AI 服务，请稍后再试。";
          setTrace((prev) => (prev ? {
            ...prev, status: "fallback", mode: "local", error: reason,
            reply: { ...prev.reply, text: finalText, reasoning, done: true },
            mcp: { ...prev.mcp, status: "error" },
            verification: { status: "fallback", sources: [], error: reason },
          } : prev));
        } else {
          finalText = "响应失败：" + reason;
          setTrace((prev) => (prev ? {
            ...prev, status: "error", error: reason,
            reply: { ...prev.reply, text: finalText, reasoning, done: true },
            mcp: { ...prev.mcp, status: "error" },
            verification: { status: "error", sources: [], error: reason },
          } : prev));
        }
        // 渲染最终文本到气泡（已流式则定稿，否则新建）
        if (bubble) bubble.finalize(finalText);
        else appendMessage("ai", finalText);
        // 兜底 / 失败路径：明确脚注「无真实依据 / 未溯源」，避免用户误信
        const fbWrap = bubble ? bubble.el : messagesEl.lastElementChild;
        const toolReads2 = extractMemoryToolReads((traceRef.current && traceRef.current.mcp && traceRef.current.mcp.invocations) || []);
        attachProvenanceFooter(fbWrap, null, { fallback: replyKind === "fallback", error: replyKind === "error", recall: built.recall, toolReads: toolReads2 });
        // 来源①：AI 错误/兜底文本含位置 → 自动地图标注（同样 strict，挡描述型噪声）
        maybeShowMap(finalText, "ai", { mode: "strict" }).catch(() => {});
        // 出行/规划意图识别（兜底路径同样触发，避免 error 路径把用户卡死）
        if (TRAVEL_INTENT_RE.test(finalText)) setTravelAction();
        runImagePipeline(finalText);   // 兜底/错误路径同样配图（旁路，不影响文本）
        if (window.CyberFx) window.CyberFx.idle();
      } finally {
        setBusy(false);
        // 会话结束：清空 MCP 面板「本轮已用工具」呼吸灯集合（防残留）
        window.dispatchEvent(new CustomEvent("jarvis:chat-session-end"));
        input.focus();
      }
    }

    function autoGrow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";  // 与 CSS max-height:160px 同步
    }
    function updateSend() {
      if (!state.busy) sendBtn.disabled = input.value.trim() === "";
    }

    // 转义动态文本，避免下拉内容注入
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    // —— @ 指令快捷下拉（输入 @ 自动弹出，↑/↓ 切换，Enter/Tab 选中，Esc 关闭）——
    let cmdPickerEl = null;
    let cmdPickerOpen = false;
    let cmdHighlight = 0;
    let cmdMatches = [];

    // 命令模式：输入框以 @ 开头且尚未出现空格（即仍在输入指令 token）
    function getCommandQuery() {
      const v = input.value;
      if (!/^@[^\s]*$/.test(v)) return null;
      return v.slice(1).toLowerCase();
    }

    function setupCommandPicker() {
      if (cmdPickerEl) return;
      const el = document.createElement("div");
      el.className = "cmd-picker";
      el.id = "cmdPicker";
      el.setAttribute("role", "listbox");
      el.setAttribute("aria-label", "可用指令");
      el.style.display = "none";
      form.appendChild(el);
      cmdPickerEl = el;
    }

    function renderPicker() {
      if (!cmdPickerEl) return;
      if (!cmdMatches.length) {
        cmdPickerEl.innerHTML = '<div class="cmd-empty">无匹配的 @ 指令</div>';
        return;
      }
      cmdPickerEl.innerHTML = cmdMatches
        .map((c, i) => {
          const active = i === cmdHighlight ? " active" : "";
          return (
            '<div class="cmd-item' + active + '" role="option"' +
            ' data-idx="' + i + '" aria-selected="' + (i === cmdHighlight) + '">' +
            '<span class="cmd-label">' + escapeHtml(c.label) + "</span>" +
            '<span class="cmd-desc">' + escapeHtml(c.desc) + "</span>" +
            "</div>"
          );
        })
        .join("");
      cmdPickerEl.querySelectorAll(".cmd-item").forEach((node) => {
        const idx = Number(node.getAttribute("data-idx"));
        node.addEventListener("mouseenter", () => {
          cmdHighlight = idx;
          renderPicker();
        });
        node.addEventListener("mousedown", (e) => {
          e.preventDefault(); // 防止 textarea 失焦
          selectHighlighted();
        });
      });
    }

    function openPicker() {
      setupCommandPicker();
      const q = getCommandQuery() || "";
      cmdMatches = AT_COMMANDS.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.desc.toLowerCase().includes(q)
      );
      cmdHighlight = 0;
      cmdPickerOpen = true;
      cmdPickerEl.style.display = "block";
      renderPicker();
    }

    function closePicker() {
      cmdPickerOpen = false;
      if (cmdPickerEl) cmdPickerEl.style.display = "none";
    }

    // 每次输入后同步：处于命令模式则刷新下拉，否则收起
    function syncPicker() {
      if (getCommandQuery() !== null) openPicker();
      else closePicker();
    }

    function moveHighlight(delta) {
      if (!cmdMatches.length) return;
      cmdHighlight =
        (cmdHighlight + delta + cmdMatches.length) % cmdMatches.length;
      renderPicker();
      const active = cmdPickerEl.querySelector(".cmd-item.active");
      if (active) active.scrollIntoView({ block: "nearest" });
    }

    function selectHighlighted() {
      const cmd = cmdMatches[cmdHighlight];
      closePicker();
      if (!cmd) return;
      input.value = cmd.insert; // 例如 "@影视搜索 "
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
      autoGrow();
      updateSend();
    }

    function setChat(open) {
      // 开合交由 React 状态（panelOpen）驱动 className / aria-hidden，
      // 不再手动操作 DOM class，避免组件重渲染时 JSX 的 className 把 open 写回。
      setPanelOpen(open);
      if (openBtn) {
        openBtn.textContent = open ? "▾ 收起对话" : "▸ AI 对话";
        openBtn.classList.toggle("active", open);
      }
    }
    function toggleChat() { setChat(!panel.classList.contains("open")); }

    // 清空上下文：重置内存历史 + 清空 DOM 消息 + 清除本地持久化；trace + 配图窗一并关闭
    function clearChat() {
      if (state.busy) return;
      if (state.history.length === 0 && messagesEl.childElementCount === 0) return;
      state.history = [];
      messagesEl.innerHTML = "";
      try { localStorage.removeItem(CONFIG.storageKey); } catch (e) { /* 忽略 */ }
      setTrace(null);
      setTraceOpen(false);
      // 通知 App.jsx 关闭配图窗口（image-window）
      window.dispatchEvent(new CustomEvent("jarvis:close-all-panels"));
      if (clearBtn) clearBtn.disabled = true;
      updateSend();
    }

    function bindChatEvents() {
      if (openBtn) {
        openBtn.addEventListener("click", toggleChat);
        openBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChat(); }
        });
      }
      closeBtn.addEventListener("click", () => setChat(false));
      if (clearBtn) clearBtn.addEventListener("click", clearChat);
      form.addEventListener("submit", (e) => { e.preventDefault(); handleSend(); });
      input.addEventListener("input", () => { autoGrow(); updateSend(); syncPicker(); });
      input.addEventListener("keydown", (e) => {
        // 下拉打开时，方向键 / Enter / Tab / Esc 优先用于选择指令
        if (cmdPickerOpen) {
          if (e.key === "ArrowDown") { e.preventDefault(); moveHighlight(1); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); moveHighlight(-1); return; }
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault(); selectHighlighted(); return;
          }
          if (e.key === "Tab") { e.preventDefault(); selectHighlighted(); return; }
          if (e.key === "Escape") { e.preventDefault(); closePicker(); return; }
        }
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          handleSend();
        }
      });
      // 失焦时收起下拉（延迟以允许下拉项的 mousedown 选中先生效）
      input.addEventListener("blur", () => { setTimeout(closePicker, 120); });
      // 影视搜索独立窗口：Esc 关闭（不拦截聊天输入框的 Esc）
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          const msw = document.getElementById("movieSearchWindow");
          if (msw && msw.classList.contains("msw-open")) closeMovieSearchWindow();
        }
      });
    }

    function init() {
      initLayout();            // 先恢复/设定几何（必须在 setChat 前）
      bindLayoutEvents();      // 绑定拖拽/缩放或移动端降级
      loadHistory();
      const snapshot = state.history;
      state.history = [];
      for (const item of snapshot) appendMessage(item.role, item.text, item.time);
      bindChatEvents();
      updateSend();
      if (clearBtn) clearBtn.disabled = state.history.length === 0;
      setChat(true);            // 默认作为主对话窗口呈现
      // 不自动聚焦输入框，避免移动端加载即弹出键盘；用户点击输入框再聚焦
    }

    init();
  }, []);

  return { trace, traceOpen, closeTrace, toggleTrace, openTrace: () => setTraceOpen(true), panelOpen, send: (text) => handleSend(text), pendingAction, clearPendingAction };
}
