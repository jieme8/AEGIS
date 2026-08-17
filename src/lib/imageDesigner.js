// 生图「设计环节」：在真正调用生图模型之前，先用 LLM 把文字内容理解并规划成一套视觉设计方案
// （主题 / 主视觉 / 版式 / 配色 / 风格 / 情绪），再据此生成英文生图提示词——类比「做 PPT」时的版式设计。
//  - 风格随内容自适应，不锁定赛博朋克。
//  - LLM 调用失败/超时 → 规则兜底（按内容关键词自适应选风格）。
//  - 设计阶段明确指示模型用「图标/图表/短标签」表达内容，而非渲染大段可读正文（文生图对长中文还原极差）。
import { IMAGE_CONFIG } from "../config/imageConfig.js";
import { providerManager } from "./providerManager.js";

const SYS_PROMPT =
  "You are a senior visual designer (slide / infographic / editorial designer). " +
  "Given the user's text content, design a visual concept for an AI text-to-image generator. " +
  "Output ONLY strict JSON (no markdown, no prose), exactly this shape:\n" +
  "{\n" +
  '  "theme": "<one-line concept capturing the content essence>",\n' +
  '  "scene": "<central visual metaphor / main subject>",\n' +
  '  "layout": "<composition arrangement, e.g. hero title band + 3 content panels + footer>",\n' +
  '  "palette": "<2-3 color keywords matching the mood>",\n' +
  '  "style": "<visual style: editorial infographic | cinematic | minimal flat | isometric | soft watercolor | technical blueprint | 3D render ... pick what fits the content; do NOT force cyberpunk>",\n' +
  '  "mood": "<emotional tone>",\n' +
  '  "imagePrompt": "<concise English image prompt (<=55 words) describing scene+layout+palette+style+mood. Express the content via icons, charts and short labels, NOT long readable paragraphs of text>"\n' +
  "}";

function getActiveChatModel() {
  try {
    const p = providerManager.getActive();
    return p && p.model ? p.model : "longcat-2.0";
  } catch {
    return "longcat-2.0";
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
  const prompt = `professional ${style}, balanced composition, ${cleaned}, high quality, detailed`.slice(0, 500);
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
          { role: "user", content: text },
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
      prompt: String(plan.imagePrompt).slice(0, 500),
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
