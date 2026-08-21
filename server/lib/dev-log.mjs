/**
 * 开发服务器统一日志输出。
 *
 * 与 concurrently 配合：concurrently 已给每行加了 [name] 前缀 + 颜色，
 * 因此本类只输出「内容」——每行一个 emoji 语义前缀 + 简洁信息，
 * 便于在混杂的多服务输出中快速扫描关键事件。
 *
 * 用法：
 *   import { log } from "../lib/dev-log.mjs";
 *   log.info("任意信息");
 *   log.ready("http://localhost:8787");   // 🚀 已就绪
 *   log.ok("完成某事");                    // ✅ 成功
 *   log.pending("进行中...");              // ⏳ 进行中
 *   log.warn("非致命问题");                // ⚠️ 警告
 *   log.error("失败原因");                 // ❌ 错误
 *   log.stat("本地种子", 68, "部");        // 📊 统计
 */

export const log = {
  info: (...a) => console.log("  ", ...a),
  ready: (url) => console.log("  🚀 已就绪 →", url),
  ok: (...a) => console.log("  ✅", ...a),
  pending: (...a) => console.log("  ⏳", ...a),
  warn: (...a) => console.warn("  ⚠️", ...a),
  error: (...a) => console.error("  ❌", ...a),
  stat: (...a) => console.log("  📊", ...a),
};
