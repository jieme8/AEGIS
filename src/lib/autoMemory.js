/**
 * 自动记忆获取（Auto Memory）。
 *
 * 思路：每轮对话结束后，复用当前选中的大模型供应商（providerManager.getActive()
 * 给出的 endpoint / apiKey / model），把本轮「用户消息 + 助手回复」交给模型提炼出
 * 值得长期保留的用户事实（身份 / 偏好 / 项目背景 / 明确要求的"记住"内容），输出为
 * 结构化 JSON 数组 [{ key, value }]，再经 MCP Relay 写入自研 memory 服务器
 * （save_memory 工具）。与已有记忆做去重：值未变则跳过，避免每轮无谓写盘。
 *
 * 设计要点：
 * - 不阻塞对话：handleSend 成功定稿后以 fire-and-forget 方式调用 runAutoMemory，
 *   失败静默忽略，绝不抛给聊天主流程。
 * - 容错解析：模型不一定返回纯 JSON，故剥离 ```json 围栏、截取首个 [ .. ] 再解析，
 *   非法/空结果视为「无记忆可保存」。
 * - 开关：localStorage `cyber-automem-v1`，默认开启；用户可在记忆弹层里关闭。
 * - 事件：捕获完成派发 `jarvis:automem` { saved, ts }；开关变更派发
 *   `jarvis:automem-config` { enabled }，供弹层刷新状态/列表。
 */

import { providerManager } from "./providerManager.js";
import { MCPClient } from "./mcpClient.js";

const LS_KEY = "cyber-automem-v1";
const mcp = new MCPClient(); // 默认 /api/mcp（同源代理 → Node 侧 Relay）

const EXTRACT_SYSTEM = [
  "你是 J.A.R.V.I.S. 的长期记忆提取器。给定「当前已存储的记忆」和「本轮对话」，",
  "请抽取值得长期保留的、关于【用户】的事实，仅输出一个 JSON 数组，元素格式为：",
  '{"key": 简短英文蛇形键(建议带命名空间前缀 user: / pref: / project:), "value": 简洁中文描述}。',
  "",
  "只抽取：",
  "· 用户身份、姓名、称呼",
  "· 用户偏好（语言、风格、工具、主题、格式）",
  "· 项目背景与上下文",
  "· 反复出现的诉求或约束",
  "· 用户明确说「记住 / 记一下 / 帮我记」的内容",
  "",
  "不要抽取：",
  "· 一次性闲聊、临时问答",
  "· 与「当前已存储记忆」完全相同的内容（系统已列出，无需重复）",
  "· 对话过程本身或转瞬即逝的状态",
  "",
  "若无值得保存的内容，输出 []。只输出 JSON，不要任何解释或前后缀文字。",
].join("\n");

// ============ 开关（localStorage） ============
export function isAutoMemoryEnabled() {
  try {
    return localStorage.getItem(LS_KEY) !== "0"; // 默认开启
  } catch (e) {
    return true;
  }
}
export function setAutoMemoryEnabled(on) {
  try {
    localStorage.setItem(LS_KEY, on ? "1" : "0");
  } catch (e) {
    /* 忽略 */
  }
  try {
    window.dispatchEvent(
      new CustomEvent("jarvis:automem-config", { detail: { enabled: !!on } })
    );
  } catch (e) {
    /* 忽略 */
  }
}

// ============ 工具结果解析（兼容 structuredContent 与纯文本回退） ============
function parseEntries(res) {
  if (res && res.raw && res.raw.structuredContent && Array.isArray(res.raw.structuredContent.entries)) {
    return res.raw.structuredContent.entries;
  }
  const out = [];
  const txt = (res && res.content) || "";
  for (const line of String(txt).split("\n")) {
    const m = line.match(/^•\s*([^=]+?)\s*=\s*(.*)$/);
    if (m) out.push({ key: m[1].trim(), value: m[2] });
  }
  return out;
}

// 从模型输出里尽量稳妥地抠出 JSON 数组
function parseExtractedJSON(text) {
  if (!text) return [];
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((it) => it && typeof it.key === "string" && it.key.trim() && typeof it.value === "string")
      .map((it) => ({
        key: it.key.trim().replace(/\s+/g, "_").replace(/^:+/, ""),
        value: it.value.trim(),
      }));
  } catch (e) {
    return [];
  }
}

// ============ 调 LLM 提炼 ============
async function callLLMExtract(existing, userText, assistantText) {
  const profile = providerManager.getActive();
  if (!profile || !profile.apiKey) return null;

  const existingStr = existing.length
    ? existing.map((e) => `- ${e.key} = ${e.value}`).join("\n")
    : "(无)";

  const messages = [
    { role: "system", content: EXTRACT_SYSTEM },
    {
      role: "user",
      content:
        `【当前已存储的记忆】\n${existingStr}\n\n` +
        `【本轮对话】\n用户：${userText}\n助手：${assistantText}\n\n` +
        `请只输出 JSON 数组。`,
    },
  ];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(profile.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + profile.apiKey,
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        max_tokens: 600,
        temperature: 0.2,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    return parseExtractedJSON(text);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function emit(detail) {
  try {
    window.dispatchEvent(new CustomEvent("jarvis:automem", { detail }));
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 执行一次自动记忆获取（幂等、容错、不抛错）。
 * @param {string} userText 用户本轮消息
 * @param {string} assistantText 助手本轮最终回复
 * @returns {Promise<{saved:number, skipped?:boolean}>}
 */
export async function runAutoMemory(userText, assistantText) {
  if (!isAutoMemoryEnabled()) return { saved: 0, skipped: true };
  if (!userText || !assistantText) return { saved: 0 };

  // 1) 取已有记忆，供模型做去重 + 仅返回增量
  let existing = [];
  try {
    existing = parseEntries(await mcp.callTool("list_memories", {}));
  } catch (e) {
    existing = [];
  }

  // 2) 调 LLM 提炼增量
  const extracted = await callLLMExtract(existing, userText, assistantText);
  if (!extracted || !extracted.length) {
    emit({ saved: 0, ts: Date.now() });
    return { saved: 0 };
  }

  // 3) 去重落盘：仅当该 key 不存在或值已变化时才写
  const existingMap = new Map(existing.map((e) => [e.key, e.value]));
  let saved = 0;
  for (const { key, value } of extracted) {
    if (existingMap.has(key) && existingMap.get(key) === value) continue;
    try {
      const r = await mcp.callTool("save_memory", { key, value });
      if (!r.isError) saved++;
    } catch (e) {
      /* 单条失败不影响其余 */
    }
  }

  emit({ saved, ts: Date.now() });
  return { saved };
}
