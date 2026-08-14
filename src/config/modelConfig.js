/*
 * 模型配置 · LongCat（OpenAI 兼容格式）
 * 文档：https://longcat.chat/platform/docs/zh/
 *
 * 开发环境（import.meta.env.DEV）：
 *   浏览器经 Vite 同源代理 /api/longcat 访问（见 vite.config.js），
 *   密钥由代理在服务端注入 —— 浏览器既不暴露密钥，也不存在跨域，
 *   可彻底解决「内置预览面板 Origin 与 CORS 不匹配导致 fetch 被拦、
 *   静默回退本地模拟」的问题。
 *
 * 生产环境（import.meta.env.DEV === false）：
 *   浏览器直连真实端点；需确保该端点允许你的部署域 CORS，
 *   否则应自建后端代理转发（避免密钥暴露到前端 bundle）。
 */
// 从 .env 读取（Vite 注入前端），不再硬编码密钥
// 变量名必须是 VITE_ 前缀才能暴露到浏览器 bundle
const LONGCHAT_API_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_LONGCAT_API_KEY) ||
  "";

// 是否为开发环境（Vite 注入）。非 ESM 环境（如 Node test）默认按生产处理。
const IS_DEV =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

export const MODEL_CONFIG = {
  provider: "longcat",
  // 开发：同源代理（无跨域、密钥不下发）；生产：直连真实端点
  endpoint: IS_DEV
    ? "/api/longcat"
    : "https://api.longcat.chat/openai/v1/chat/completions",
  apiKey: LONGCHAT_API_KEY,
  // 是否由浏览器携带 Authorization：dev 经代理、由代理注入，浏览器不发送
  sendAuthFromBrowser: !IS_DEV,
  model: "LongCat-2.0",
  // —— MCP 工具调用（Agent 能力，第一期 fetch，详见 MCP-INTEGRATION-PLAN.md）——
  // D1 确认 LongCat-2.0 支持 OpenAI 兼容 tool_calls，无需更换模型。
  supportsTools: true,
  // 是否启用 MCP 工具调用（经同源 /api/mcp 代理到 Node 侧 MCP Relay）
  toolsEnabled: true,
  // 浏览器侧 MCP 门面请求的同源前缀（由 vite 代理转发到 Relay，见 vite.config.js）
  mcpRelay: "/api/mcp",
  // tool-loop 最大迭代次数（防失控）
  maxToolIterations: 5,
  // LongCat-2.0 为推理模型：推理过程(reasoning_content)与最终回答(content)
  // 共用 max_tokens 预算。预算过小会导致推理吃光额度、正文为空。
  // 设为 2000 以保证推理后仍有充足额度输出正文（流式下正文才会真正显示）。
  maxTokens: 2000,
  temperature: 0.7,
  // 请求超时（毫秒）
  timeoutMs: 30000,
  // 失败时回退到本地模拟回复（仅作兜底，正常不应触发；失败时会在控制台报错）
  fallbackToLocal: true,
};

/*
 * 生产环境建议（密钥不进前端 bundle）：
 *   1) 在项目根目录创建 .env，写入  VITE_LONGCAT_API_KEY=ak_xxx
 *   2) 将上方 LONGCHAT_API_KEY 改为  import.meta.env.VITE_LONGCAT_API_KEY
 *   3) 自建一个服务端代理（与 dev 代理同理）转发到 LongCat
 */
