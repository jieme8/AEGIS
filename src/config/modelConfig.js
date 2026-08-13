/*
 * 模型配置 · LongCat（OpenAI 兼容格式）
 * 文档：https://longcat.chat/platform/docs/zh/
 *
 * 说明：本应用为纯前端（无后端），密钥会随打包产物下发到浏览器。
 * 仅适合本地 / 演示环境；生产环境务必改为经由自有后端代理转发请求，
 * 避免 API Key 暴露（见 README / 注释中的 VITE_ 环境变量方案）。
 */
export const MODEL_CONFIG = {
  provider: "longcat",
  // OpenAI 兼容对话补全端点
  endpoint: "https://api.longcat.chat/openai/v1/chat/completions",
  apiKey: "ak_2jJ7rL9fb9re8xg22J4Vu26H6RY6k",
  model: "LongCat-2.0",
  maxTokens: 1000,
  temperature: 0.7,
  // 请求超时（毫秒）
  timeoutMs: 30000,
  // 失败时回退到本地模拟回复
  fallbackToLocal: true,
};

/*
 * 生产环境建议（密钥不进前端 bundle）：
 *   1) 在项目根目录创建 .env，写入  VITE_LONGCAT_API_KEY=ak_xxx
 *   2) 将上方 apiKey 改为  import.meta.env.VITE_LONGCAT_API_KEY
 *   3) 自建一个 /api/chat 代理，由服务端携带密钥转发到 LongCat
 */
