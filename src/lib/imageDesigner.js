// 生图「设计环节」：在真正调用生图模型之前，先用 LLM 把文字内容理解并规划成一套视觉设计方案
// （主题 / 主视觉 / 版式 / 配色 / 风格 / 情绪），再据此生成英文生图提示词——类比「做 PPT」时的版式设计。
//  - 风格随内容自适应，不锁定赛博朋克。
//  - LLM 调用失败/超时 → 规则兜底（按内容关键词自适应选风格）。
//  - 设计阶段明确指示模型用「图标/图表/短标签」表达内容，而非渲染大段可读正文（文生图对长中文还原极差）。
import { IMAGE_CONFIG } from "../config/imageConfig.js";
import { providerManager } from "./providerManager.js";

const SYS_PROMPT =
  "You are a senior visual designer (editorial / infographic / concept art). " +
  "Given the user's text content, design a visual concept for an AI text-to-image model and output ONLY strict JSON (no markdown, no prose):\n" +
  "{\n" +
  '  "theme": "<one-line concept capturing the content essence>",\n' +
  '  "scene": "<central visual metaphor / hero subject>",\n' +
  '  "layout": "<composition: framing, focal point, foreground/background structure, e.g. centered hero + balanced side panels>",\n' +
  '  "palette": "<2-4 specific colors, e.g. deep teal, warm amber, off-white>",\n' +
  '  "style": "<visual style: editorial infographic | cinematic | minimal flat | isometric | soft watercolor | technical blueprint | 3D render ... pick what fits; do NOT force cyberpunk>",\n' +
  '  "mood": "<emotional tone: calm, energetic, solemn, playful ...>",\n' +
  '  "imagePrompt": "<rich English image prompt (up to ~80 words). Describe scene + layout + palette + style + mood + lighting + material + depth. Convey the content essence through symbolism, icons, charts and SHORT labels. Do NOT try to render long readable paragraphs of body text — models garble small text>"\n' +
  "}";

function getActiveChatModel() {
  try {
    const p = providerManager.getActive();
    return p && p.model ? p.model : "LongCat-2.0";
  } catch {
    return "LongCat-2.0";
  }
}

function clean(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_~`|-]{1,3}\s?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 从长文里抽一个简短「内容摘要」给设计 LLM 当 subject brief（标题 + 几条要点），
// 避免把 2000 字原文直接塞给模型导致要点被稀释、出图跑偏。
function extractOutline(text) {
  const seg = clean(text)
    .split(/[。.!?！？]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const title = seg[0] || "";
  const rest = seg.slice(1, 5).join(" ");
  return [title, rest].filter(Boolean).join("  ·  ").slice(0, 400);
}

// 把设计环节算出的全部字段拼回最终生图提示词。
// 关键：image-proxy 的 buildBody 不认 style 参数，style/palette/mood/layout 必须写进 prompt 文本模型才会用到。
// 末尾烘焙质量指令（代理忽略 negativePrompt，故写进正文），稳定提质。
function composePrompt(plan) {
  const parts = [];
  if (plan.imagePrompt) parts.push(String(plan.imagePrompt).trim());
  if (plan.style) parts.push("Visual style: " + plan.style);
  if (plan.palette) parts.push("Color palette: " + plan.palette);
  if (plan.mood) parts.push("Mood: " + plan.mood);
  if (plan.layout) parts.push("Composition: " + plan.layout);
  parts.push("Cinematic lighting, rich detail, sharp focus, professional grade, coherent visual design");
  parts.push("No watermark, no deformed text, no distorted typography, no extra limbs");
  return parts.filter(Boolean).join(", ").slice(0, 900);
}

// 规则兜底：根据内容关键词自适应选风格，避免锁死赛博朋克。
function buildRuleDesign(text, opts) {
  const t = (text || "").toLowerCase();
  let style = "clean editorial infographic";
  if (/代码|编程|开发|算法|架构|工程|code|program|developer|algorithm|tech/.test(t)) style = "technical blueprint, schematic";
  else if (/温暖|治愈|故事|文化|情感|人文|warm|story|culture|human/.test(t)) style = "soft cinematic, warm tones";
  else if (/数据|报告|市场|财务|增长|data|report|market|finance|growth/.test(t)) style = "minimal flat dashboard";
  else if (/自然|风景|旅行|城市|nature|landscape|travel|city/.test(t)) style = "vibrant illustrative";
  else if (/科技|ai|智能|机器人|芯片|science|robot|chip/.test(t)) style = "futuristic clean render";
  const cleaned = clean(text).slice(0, 80);
  const qualityTail = "balanced composition, cinematic lighting, rich detail, sharp focus, professional grade, no watermark, no deformed text";
  const prompt = `professional ${style}, ${cleaned}, ${qualityTail}`.slice(0, 500);
  return {
    prompt,
    display: cleaned.length > 280 ? cleaned.slice(0, 278) + "…" : cleaned,
    style,
    palette: "",
    theme: "",
    layout: "",
    aspectRatio: opts.aspect || "16:9",
    source: "designer-rule",
    overlayText: text,
  };
}

// 设计环节主入口（异步）：LLM 出结构化设计 + 提示词；失败回退规则。
export async function designImagePrompt(text, opts = {}) {
  if (IMAGE_CONFIG.optimizer === "rule") return buildRuleDesign(text, opts);
  const rule = buildRuleDesign(text, opts);
  try {
    const model = getActiveChatModel();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch("/api/longcat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: `Subject brief: ${extractOutline(text)}\n\nFull content:\n${text}` },
        ],
        temperature: 0.5,
        max_tokens: 600,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error("llm " + res.status);
    const data = await res.json();
    let raw = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    raw = String(raw).trim().replace(/^```[\s\S]*?\n?/i, "").replace(/```$/i, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const json = start >= 0 && end > start ? raw.slice(start, end + 1) : null;
    const plan = json ? JSON.parse(json) : null;
    if (!plan || !plan.imagePrompt) throw new Error("bad plan");
    return {
      prompt: composePrompt(plan),
      display: clean(text).length > 280 ? clean(text).slice(0, 278) + "…" : clean(text),
      style: plan.style || rule.style,
      palette: plan.palette || "",
      theme: plan.theme || "",
      layout: plan.layout || "",
      aspectRatio: opts.aspect || "16:9",
      source: "designer",
      overlayText: text,
    };
  } catch (e) {
    return rule;
  }
}
