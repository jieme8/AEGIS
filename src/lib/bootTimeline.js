// =========================================================
// 启动序列时间线（BOOT → 组件错落入场）
// 显式集中定义：BOOT 时长 + 各组件入场顺序 / 延迟 / 时长 / 缓动。
// 与 cyber.css 中的 [data-seq] / body.booted 规则一一对应。
// =========================================================

// 启动遮罩持续时间（扫描线/启动环/日志/进度条填满）
export const BOOT_MS = 2400;

// 主界面各组件的错落入场编排
//   at   : 相对 BOOT 结束后的延迟(ms)
//   dur  : 动画时长(ms)
//   ease : 缓动曲线（ease-out 族，末段减速 → 自然不僵硬）
//   el   : 对应 DOM 的 data-seq 值
export const SEQUENCE = [
  { el: "title",      at: 120,  dur: 700, ease: "cubic-bezier(.16,1,.3,1)"  },
  { el: "stage",      at: 360,  dur: 750, ease: "cubic-bezier(.2,.8,.2,1)"  },
  { el: "form-switch",at: 520,  dur: 550, ease: "cubic-bezier(.2,.9,.25,1)" },
  { el: "hacker",     at: 640,  dur: 600, ease: "cubic-bezier(.2,.9,.25,1)" },
  { el: "hud-bl",     at: 760,  dur: 600, ease: "cubic-bezier(.2,.9,.25,1)" },
  { el: "task-bar",   at: 900,  dur: 600, ease: "cubic-bezier(.2,.9,.25,1)" },
  { el: "oil",        at: 940,  dur: 600, ease: "cubic-bezier(.2,.9,.25,1)" },
  { el: "chat",       at: 1080, dur: 650, ease: "cubic-bezier(.16,1,.3,1)"  },
];

// 启动日志（终端打字感），逐行在 BOOT 期间浮现
export const BOOT_LOG = [
  { t: "CORE NEURAL LINK ESTABLISHED", ok: true  },
  { t: "SPECTRUM SUBSYSTEM ONLINE",    ok: true  },
  { t: "NEON RENDER PIPELINE READY",   ok: true  },
  { t: "CALIBRATING HOLO-INTERFACE",   ok: false },
  { t: "J.A.R.V.I.S. AWAITING COMMAND", ok: true },
];
