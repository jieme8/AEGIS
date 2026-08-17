// 生图功能配置（终态触发 · 单图输出）
// 设计原则：默认关闭对现有功能零影响；默认 provider=local 离线可跑、无需密钥，
// 仅用于即时可见效果。切真实生图 API 只需把 provider 改为 "http" 并配齐下方 .env 项。
export const IMAGE_CONFIG = {
  // 总开关：false 时整条管线不执行，行为与改造前完全一致
  enabled: true,

  // 生图后端：local（canvas 离线渲染，无需密钥）| http（走 /api/genimg 代理调真实模型）
  // 已接入多家真实生图 provider（密钥只在服务端 image-proxy 持有，见 IMAGE_PROFILES）
  provider: "http",

  // 默认风格：cyber | clean | cinematic（影响 local 渲染配色 + 真实模型提示词前缀）
  style: "cyber",

  // 默认比例（Agnes 支持的 ratio：1:1,3:4,4:3,16:9,9:16,2:3,3:2,21:9）
  aspect: "16:9",

  // 价值判定：是否在对话流里显示「是否值得生图」的判定结果
  showJudgment: true,

  // 是否启用轻量预筛：true=仅当内容有价值时才生图；false=每条回答都强制生图
  skipWhenUnsuitable: true,

  // 判定置信度阈值（0~1）：评分低于此值且无非明确诉求时不生图
  judgeThreshold: 0.35,

  // 轻量预筛：最少字数（低于则直接判为不适合）
  minChars: 20,

  // 提示词优化实现：rule（离线规则）| llm（复用 /api/longcat 把最终回答改写成精准英文提示词，相关性最佳；失败自动回退 rule）
  optimizer: "llm",

  // 调用参数
  // 注意：本环境到生图服务端的网络较慢，SenseNova 冷启 ~40-60s、Agnes ~30s，
  // 故超时设 120s，避免 AbortController 在生图完成前中断（否则慢模型"一直失败"）。
  timeoutMs: 120000,
  retries: 2,

  // http provider 的同源代理路径（vite 代理 + 服务端 image-proxy 共用）
  httpEndpoint: "/api/genimg",
};

// 多生图供应商（仅展示信息 id/label/model；密钥只存在于服务端 image-proxy，绝不进前端 bundle）。
// 前端下拉框列出这些项，选中后把 id 随请求发到 /api/genimg，由服务端按 id 取对应密钥。
// 新增供应商：此处加一项 + 在 server/image-proxy.mjs 的 PROVIDERS 里补一个适配器（base/key/model/buildBody/parse）。
export const IMAGE_PROFILES = [
  { id: "agnes", label: "Agnes Image 2.1 Flash", model: "agnes-image-2.1-flash" },
  { id: "sensenova", label: "SenseNova U1 Fast", model: "sensenova-u1-fast" },
];

// 默认激活的生图供应商 id（用户可在配图窗口下拉切换，选择存 localStorage）
export const IMAGE_DEFAULT_PROVIDER = "agnes";

// 真实生图 provider（provider=http 时使用）所需环境变量（仅服务端持有，绝不进前端）：
//   Agnes:    IMAGE_API_KEY / IMAGE_BASE_URL / IMAGE_MODEL
//   SenseNova: SENSENOVA_API_KEY / SENSENOVA_BASE_URL / SENSENOVA_MODEL
