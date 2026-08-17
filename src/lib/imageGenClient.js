// 生图调用客户端：按 IMAGE_CONFIG.provider 分发。
//  - local：调用 localImageRenderer，离线生成，无需密钥（默认，用于即时可见效果）
//  - http ：经同源 /api/genimg 调真实生图模型（密钥只在服务端 image-proxy 持有）
import { IMAGE_CONFIG } from "../config/imageConfig.js";
import { renderLocalImage } from "./localImageRenderer.js";

async function generateViaHttp(optimized) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_CONFIG.timeoutMs);
  let lastErr;
  for (let i = 0; i <= IMAGE_CONFIG.retries; i++) {
    try {
      const res = await fetch(IMAGE_CONFIG.httpEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: optimized.prompt,
          negativePrompt: "",
          aspect: optimized.aspectRatio,
          style: optimized.style,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data || (!data.url && !data.data)) throw new Error("未返回图片");
      clearTimeout(timer);
      return {
        id: data.id || "http-" + Date.now(),
        url: data.url || data.data,
        model: data.model || IMAGE_CONFIG.provider,
        meta: data,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  clearTimeout(timer);
  throw lastErr || new Error("生图失败");
}

export async function generateImage(optimized) {
  if (IMAGE_CONFIG.provider === "http") {
    return generateViaHttp(optimized);
  }
  // 本地渲染器：离线、无需密钥
  const url = await renderLocalImage({
    display: optimized.display,
    style: optimized.style,
    aspect: optimized.aspectRatio,
    seed: Math.floor(Math.random() * 1000),
  });
  return {
    id: "local-" + Date.now(),
    url,
    model: "local-renderer",
    meta: { style: optimized.style, local: true },
  };
}
