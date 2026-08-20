/**
 * 共享：trace 面板敏感字符串过滤
 *
 * 用于 trace prompt / context / tools 等暴露"原始上下文给用户看"的场景。
 * 过滤对象：模型 prompt 里注入的多模态引用（@image#N / <image_local_path>）、
 * 本地绝对路径、明显的图片文件名等——它们对用户排查对话无意义且泄露路径。
 *
 * 设计：
 *  - 仅匹配结构化引用 / 已知后缀的图片路径，**不**误伤真实正文 URL。
 *  - 用「可识别的占位」替代删除，便于一眼看出"这里原本有图被吃了"。
 *  - sanitize* 是纯函数，便于单测和共享。
 */

// @image#3:"<file>"（多模态模型常见引用格式；引号内允许嵌套引号，用 [\\s\\S] 兜底）
const RE_IMAGE_REF = /@image#\d+:\s*"[\s\S]*?"/g;

// <image_local_path>...</image_local_path>（本仓库多模态的备用格式）
const RE_IMAGE_LOCAL = /<image_local_path>[\s\S]*?<\/image_local_path>/g;

// "image_local_path": "C:\xxx\yyy.png"（JSON 字段）
const RE_JSON_IMG_FIELD = /("image_local_path"\s*:\s*")[^"]+(")/g;

// Windows 绝对路径 + 常见图片后缀（C:\foo\bar.png / D:/xx/xx.jpg 等）
const RE_WIN_IMG_PATH =
  /[A-Za-z]:[\\\/][^\s'",<>`{}|\[\]]+?\.(?:png|jpe?g|webp|gif|bmp|svg|heic|heif|avif)(?:\s|[",<>)}\]]|$)/gi;

// 单文件相对路径引用 ./xxx.png 或 /xxx.png（仅在尾部/标点位置）
const RE_REL_IMG_PATH = /(?:^|[\s,(>])(\.[\/\\][^\s'",<>]*?\.(?:png|jpe?g|webp|gif|bmp|svg))(?=[\s,)<]|$)/gi;

const IMG_PLACEHOLDER = "[附图]";

/**
 * 把敏感引用抹掉并替换为占位符。
 * @param {string} text
 * @returns {string}
 */
export function sanitizeImageRefs(text) {
  if (!text) return text;
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch (_) {
      return String(text);
    }
  }
  let s = text;
  // 长路径优先（避免先吃短路径留下尾巴）
  s = s.replace(RE_IMAGE_REF, IMG_PLACEHOLDER);
  s = s.replace(RE_IMAGE_LOCAL, IMG_PLACEHOLDER);
  s = s.replace(RE_JSON_IMG_FIELD, `$1${IMG_PLACEHOLDER}$2`);
  // Windows 绝对路径
  s = s.replace(RE_WIN_IMG_PATH, (m) => {
    // 保留前/后标点
    const lead = m.match(/^\s/) ? " " : "";
    const trail = m.match(/[",<>)}\]\s]$/) ? m.slice(-1) : "";
    return lead + IMG_PLACEHOLDER + trail;
  });
  // 相对图片路径
  s = s.replace(RE_REL_IMG_PATH, (m) => {
    const lead = m[0] === " " || m[0] === "," || m[0] === "(" || m[0] === ">" ? m[0] : " ";
    return lead + IMG_PLACEHOLDER;
  });
  // 合并多余空白
  s = s.replace(/[ \t]{2,}/g, " ");
  return s;
}

/**
 * 把 JSON 字符串整体 sanitize 掉再解析回对象。
 * 注意：只对 value 里的字符串字段做替换，对象 key 不动。
 * 用于在 TracePrompt 里把完整的 messages JSON 美化展示，但不去掉图片引用。
 */
export function sanitizeJsonString(jsonStr) {
  if (!jsonStr || typeof jsonStr !== "string") return jsonStr || "";
  return sanitizeImageRefs(jsonStr);
}

/**
 * 单字段显示：把原始字符串 sanitize 后截断。
 * 用于工具面板的"name"/"server"/返回摘要。
 */
export function sanitizeField(value, maxLen = 80) {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : safeJsonStringify(value);
  const clean = sanitizeImageRefs(text);
  return clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean || "—";
}

function safeJsonStringify(v) {
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}
