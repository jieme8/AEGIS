// 提示词优化模块：把助手「最终输出文本」改写为适配生图模型的高质量图像提示词。
//  - optimizer = "llm" ：复用 /api/longcat 把最终回答改写成精准、内容优先的英文生图提示词（相关性最佳）。
//  - optimizer = "rule"：离线规则（不依赖 LLM），内容优先 + 风格后缀。
//  - llm 调用失败/超时自动回退 rule，保证不阻塞生图。
import { IMAGE_CONFIG } from "../config/imageConfig.js";
import { providerManager } from "./providerManager.js";

// 风格 → 图像提示词「后缀」（作为修饰，不抢占主体）
const STYLE_SUFFIX = {
  cyber: "cyberpunk neon aesthetic, high contrast, futuristic, glowing lines, detailed",
  clean: "clean flat illustration, minimal, infographic style, soft palette",
  cinematic: "cinematic lighting, photorealistic, dramatic composition, depth of field",
  default: "illustration, detailed, balanced composition",
};

// 清洗：去掉 markdown / 代码块 / 图片链接 / URL / 多余符号，保留可读语义
function clean(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")          // 代码块
    .replace(/`([^`]+)`/g, "$1")               // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // markdown 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // markdown 链接（保留文案）
    .replace(/https?:\/\/\S+/g, " ")           // 裸 URL
    .replace(/[#>*_~`|-]{1,3}\s?/g, " ")       // 标记符号
    .replace(/\s+/g, " ")
    .trim();
}

// 规则模式：内容优先（取清洗后的主体，风格作后缀），避免整段回答埋进 depicting: 被模型忽略
function buildRulePrompt(text, opts) {
  const style = opts.style || "cyber";
  const cleaned = clean(text);
  const subject = (cleaned || "abstract cyber scene").slice(0, 160);
  const suffix = STYLE_SUFFIX[style] || STYLE_SUFFIX.default;
  const prompt = `${subject}, ${suffix}`.slice(0, 400);
  return {
    prompt,
    display: cleaned.length > 280 ? cleaned.slice(0, 278) + "…" : cleaned,
    style,
    aspectRatio: opts.aspect || "16:9",
    source: "rule",
  };
}

const SYS_PROMPT =
  "You are an image-prompt engineer. Convert the assistant's reply into a SINGLE concise English image-generation prompt (max 55 words). " +
  "Capture the main subject/scene, key objects, mood, lighting and composition. Remove explanations, greetings, markdown and numbering. " +
  "Output ONLY the prompt text, nothing else.";

function getActiveChatModel() {
  try {
    const p = providerManager.getActive();
    return p && p.model ? p.model : "longcat-2.0";
  } catch (e) {
    return "longcat-2.0";
  }
}

// LLM 模式：把最终回答改写成内容精准的英文提示词（相关性最佳）；失败回退 rule
async function optimizePromptLlm(text, opts) {
  const rule = buildRulePrompt(text, opts);
  try {
    const model = getActiveChatModel();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch("/api/longcat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0.35,
        max_tokens: 600,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error("llm " + res.status);
    const data = await res.json();
    let out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    out = out ? String(out).trim() : "";
    // 去掉可能的 ``` 围栏 / "Prompt:" 前缀，确保拿到纯提示词
    out = out.replace(/^```[\s\S]*?\n?/i, "").replace(/```$/i, "").replace(/^(prompt\s*[:：]\s*)/i, "").trim();
    if (!out) throw new Error("empty llm prompt");
    const style = opts.style || "cyber";
    const suffix = STYLE_SUFFIX[style] || STYLE_SUFFIX.default;
    const prompt = (out + (suffix ? ", " + suffix : "")).slice(0, 500);
    return {
      prompt,
      display: clean(text).length > 280 ? clean(text).slice(0, 278) + "…" : clean(text),
      style,
      aspectRatio: opts.aspect || "16:9",
      source: "llm",
    };
  } catch (e) {
    return { ...rule, source: "rule-fallback" };
  }
}

// 统一入口（异步）：默认 llm，失败回退 rule
export async function optimizePrompt(text, opts = {}) {
  if (IMAGE_CONFIG.optimizer === "llm") {
    return optimizePromptLlm(text, opts);
  }
  return buildRulePrompt(text, opts);
}
