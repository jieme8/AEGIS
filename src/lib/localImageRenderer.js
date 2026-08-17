// 本地图像渲染器（provider=local）：用 canvas 把最终输出的文本渲染成一张
// 赛博风 PNG（dataURL）。离线可用、无需任何外部密钥，用于即时可见效果。
// 切到真实生图 API 后本文件不再被调用（由 imageGenClient 分发到 http 路径）。

const STYLE_PALETTE = {
  cyber: { hue: 188, accent: "0,240,255" },     // 青色霓虹
  clean: { hue: 280, accent: "180,120,255" },   // 紫色
  cinematic: { hue: 22, accent: "255,140,60" }, // 暖橙
  default: { hue: 188, accent: "0,240,255" },
};

function wrapText(ctx, text, x, y, maxW, lh) {
  const chars = Array.from(text);
  let line = "";
  let yy = y;
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lh;
    } else {
      line += ch;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

export function renderLocalImage({ display, style = "cyber", aspect = "16:9", seed = 0 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const [aw, ah] = String(aspect).split(":").map(Number);
      const W = 800;
      const H = Math.max(320, Math.round((W * (ah || 9)) / (aw || 16)));
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      const pal = STYLE_PALETTE[style] || STYLE_PALETTE.default;
      const hue = (pal.hue + (seed % 30)) % 360;

      // 背景渐变
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, `hsl(${hue},65%,7%)`);
      g.addColorStop(1, `hsl(${(hue + 40) % 360},60%,3%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 霓虹网格
      ctx.strokeStyle = `hsla(${hue},90%,60%,0.12)`;
      ctx.lineWidth = 1;
      const step = 40;
      for (let x = step; x < W; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = step; y < H; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // 外框
      ctx.strokeStyle = `hsl(${hue},90%,62%)`;
      ctx.lineWidth = 3;
      ctx.strokeRect(16, 16, W - 32, H - 32);

      // 标题
      ctx.fillStyle = `hsl(${hue},90%,72%)`;
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillText("J.A.R.V.I.S. · 生成配图", 36, 56);

      // 正文
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "16px system-ui, sans-serif";
      wrapText(ctx, display || "（无可视内容）", 36, 100, W - 72, 26);

      // 页脚
      ctx.fillStyle = `rgba(${pal.accent},0.7)`;
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(`style: ${style} · ${aspect}`, 36, H - 28);

      resolve(canvas.toDataURL("image/png"));
    } catch (e) {
      reject(e);
    }
  });
}
