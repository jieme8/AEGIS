// 生图编排门面（终态触发 · 单图输出）
//  - runImagePipeline(finalText)：在助手最终回答完成后被调用一次（fire-and-forget）。
//  - 职责：价值判定 → 在对话流显示判定 → 提示词优化 → 调生图客户端 → 通过事件桥把图推到独立「配图窗口」。
//  - 解耦：配图渲染不再写进 chat-panel，改由 ImageWindow 监听 jarvis:image-* 事件画廊式呈现。
//  - 完全旁路：不改动既有文本流；任何失败仅影响那张图，文本回答不受影响。
import { IMAGE_CONFIG } from "../config/imageConfig.js";
import { designImagePrompt } from "./imageDesigner.js";
import { generateImage } from "./imageGenClient.js";
import { aspectManager } from "./aspectManager.js";

// ============================================================
// 价值判定（是否值得生图）
//  —— 纯前端规则（免费、零延迟），输出 suitable/score/type/原因，并在对话流展示。
//  —— 后续可升级为「复用 /api/longcat 做一次分类」以更精准（切换点已预留）。
// ============================================================
function assessValue(text) {
  const t = text || "";
  const len = t.length;
  const codeBlocks = (t.match(/```/g) || []).length / 2;
  const tableRows = (t.match(/\|[^\n]+\|/g) || []).length;
  const equations = (t.match(/\$[^$]+\$|\bfrac\{|\b\sum_|\b\int_|\b\\begin\{/g) || []).length;

  // 视觉信号关键词（中英文），用于「这段内容是否可被画出来」
  const visualKW = [
    "图", "画面", "场景", "示意图", "插图", "插画", "渲染", "想象", "描述",
    "形象", "景观", "画面感", "画面中", "如图", "diagram", "illustration",
    "image", "scene", "render", "visual", "picture", "landscape", "portrait",
  ];
  const signals = Array.from(new Set(visualKW.filter((k) => t.toLowerCase().includes(k.toLowerCase()))));

  // 明确生图诉求（用户/模型表达「要画图」）
  const explicit = /画[一了张幅个]|生成[图张]|配[张]?图|帮我画|画个|出[张]?图|想象一下|描述一下|描述一个|配一张|示意图/.test(t);

  // 内容类型识别（决定生图风格与提示词侧重）
  let type = "scene";
  let typeLabel = "场景图";
  if (/表[格状]|图表|chart|graph|数据图|柱状|饼图|折线|曲线图/.test(t)) { type = "chart"; typeLabel = "图表/数据图"; }
  else if (/示意图|架构[图]|流程[图]|框图|schematic|diagram|拓扑|结构图/.test(t)) { type = "diagram"; typeLabel = "示意图/架构图"; }
  else if (/\bui\b|界面|原型|mockup|布局|设计稿|线框|页面/.test(t)) { type = "ui_mockup"; typeLabel = "UI 原型"; }
  else if (/概念|concept|角色|人物|插画|illustration|漫画|海报|头像/.test(t)) { type = "concept_art"; typeLabel = "概念插画"; }

  // 综合评分（0~1）
  let score = 0;
  score += Math.min(signals.length * 0.22, 0.66); // 视觉关键词
  if (explicit) score += 0.3;                     // 明确诉求
  score += Math.min(len / 250, 0.25);             // 文本丰度
  if (codeBlocks === 0) score += 0.1;             // 非纯代码
  score = Math.max(0, Math.min(1, score));

  // 硬性不适合（直接判否，给出原因）
  let hardUnsuitable = false;
  let hardReason = "";
  if (len < IMAGE_CONFIG.minChars) {
    hardUnsuitable = true;
    hardReason = `文本过短（${len} 字 < ${IMAGE_CONFIG.minChars}），缺乏可描绘内容`;
  } else if (codeBlocks >= 1 && signals.length === 0 && tableRows === 0) {
    hardUnsuitable = true;
    hardReason = "以代码/命令为主，无视觉描述需求";
  } else if (tableRows >= 3 && signals.length === 0) {
    hardUnsuitable = true;
    hardReason = "以数据表格为主，无视觉场景需求";
  } else if (equations >= 2 && signals.length === 0) {
    hardUnsuitable = true;
    hardReason = "以公式推导为主，无视觉场景需求";
  }

  const suitable = !hardUnsuitable && (score >= IMAGE_CONFIG.judgeThreshold || explicit);

  // 文案
  let reason;
  if (hardUnsuitable) reason = hardReason;
  else if (suitable) reason = signals.length ? `检出视觉信号：${signals.slice(0, 3).join("、")}` : (explicit ? "检出明确生图诉求" : `综合评分 ${score.toFixed(2)} ≥ 阈值`);
  else reason = `未检出足够视觉信号（评分 ${score.toFixed(2)} < 阈值 ${IMAGE_CONFIG.judgeThreshold}）`;

  return { suitable, score, type, typeLabel, signals, reason, explicit };
}

// ============================================================
// 对话内「生图价值判定」消息（保留在聊天流，满足「价值判定也要在对话里显示」）
// ============================================================
function appendJudgment(suitable, assess, forced) {
  const messagesEl = document.getElementById("chatMessages");
  if (!messagesEl) return;

  const wrap = document.createElement("div");
  wrap.className = "chat-msg ai chat-img-judge";
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = "AI · 生图判定";
  const bubble = document.createElement("div");
  bubble.className = "bubble chat-judge-bubble";

  const chip = document.createElement("div");
  chip.className = "judge-chip " + (suitable ? "ok" : "no");
  const icon = document.createElement("span");
  icon.className = "judge-icon";
  icon.textContent = suitable ? "✓" : "⊘";
  const main = document.createElement("span");
  main.className = "judge-main";
  main.textContent = suitable
    ? `值得生图 · ${assess.typeLabel} · 置信度 ${assess.score.toFixed(2)}`
    : "暂不生成配图";
  chip.appendChild(icon);
  chip.appendChild(main);

  const sub = document.createElement("div");
  sub.className = "judge-sub";
  sub.textContent = (forced ? "（强制模式）" : "") + assess.reason;

  bubble.appendChild(chip);
  bubble.appendChild(sub);
  wrap.appendChild(who);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);

  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ============================================================
// 事件桥：配图渲染与聊天面板解耦，统一推到独立 ImageWindow
// ============================================================
let regenBound = false;
const regenRegistry = new Map();

function emitStart(id) {
  window.dispatchEvent(new CustomEvent("jarvis:image-start", { detail: { id } }));
}
function emitReady(id, url, prompt, meta, model, source) {
  window.dispatchEvent(
    new CustomEvent("jarvis:image-ready", { detail: { id, url, prompt, meta, model, source } })
  );
}
// 提示词就绪即推给窗口：生图过程中就显示「将用于生图的提示词」（先于出图）
function emitPrompt(id, prompt, source) {
  window.dispatchEvent(
    new CustomEvent("jarvis:image-prompt", { detail: { id, prompt, source } })
  );
}
function emitError(id, message) {
  window.dispatchEvent(new CustomEvent("jarvis:image-error", { detail: { id, message } }));
}

// 绑定一次「重生成」监听（避免 HMR 重复绑定）
if (typeof window !== "undefined" && !regenBound) {
  regenBound = true;
  window.addEventListener("jarvis:image-regen", (e) => {
    const id = e.detail && e.detail.id;
    const fn = regenRegistry.get(id);
    if (fn) fn();
  });
}

async function generateFor(id, finalText, assess) {
  try {
    // 设计环节：先把文字内容规划成视觉方案（主题/版式/配色/风格），再出提示词去生图
    const optimized = await designImagePrompt(finalText, {
      aspect: aspectManager.getActive(),
    });
    emitPrompt(id, optimized.prompt, optimized.source); // 提示词就绪即显示（生图进行中）
    const img = await generateImage(optimized);
    emitReady(
      id,
      img.url,
      optimized.prompt,
      img.meta,
      img.meta && img.meta.model,
      optimized.source
    );
    if (window.CyberFx) {
      window.CyberFx.output();
      setTimeout(() => {
        if (window.CyberFx) window.CyberFx.idle();
      }, 900);
    }
  } catch (e) {
    emitError(id, (e && e.message) || "未知错误");
    if (window.CyberFx) window.CyberFx.idle();
  }
}

// 终态触发入口：在主对话 finalize 后调用（不 await，不阻塞文本与 setBusy）。
export async function runImagePipeline(finalText) {
  if (!IMAGE_CONFIG.enabled) return;
  if (!finalText || typeof finalText !== "string") return;
  const text = finalText.trim();

  const assess = assessValue(text);
  const forced = !IMAGE_CONFIG.skipWhenUnsuitable;
  const suitable = forced || assess.suitable;

  // 1) 在对话流显示「是否值得生图」的价值判定（仍留在聊天框）
  if (IMAGE_CONFIG.showJudgment) {
    appendJudgment(suitable, assess, forced);
  }

  // 2) 不适合且不强制 → 结束（不生成配图）
  if (!suitable) return;

  // 3) 生成配图 → 推到独立「配图窗口」（不再写进 chat-panel）
  const id = "img-" + Date.now() + "-" + Math.floor(Math.random() * 1e4);
  emitStart(id);
  if (window.CyberFx) window.CyberFx.thinking();

  const run = () => {
    emitStart(id); // 重生成时把这张卡置回「生成中」
    generateFor(id, text, assess);
  };
  regenRegistry.set(id, run);
  // 轻微延时：让「生成中」态与 thinking 形变可见，模拟生图耗时
  setTimeout(run, 500);
}
