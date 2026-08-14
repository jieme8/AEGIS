// 组件 ID → 中文名（用于悬停读数 / 清单，方便向智能体精准指代）
export const DEV_NAMES = {
  "fx-scanbar": "移动扫描光带",
  "fx-spectrum": "频谱可视化画布",
  "fx-title": "顶部故障标题",
  "hud-tr": "右上 HUD · 单位/频段",
  "hud-bl": "左下 HUD · 能量/峰值",
  "hud-br": "右下 HUD · 频率/增益",
  "fx-hacker-stream": "左侧黑客数据流",
  "chat-panel": "主对话窗口",
  "fx-ring": "中央环形波形",
  "fx-bars": "底部频谱柱阵列",
  "fx-form-switch": "形态切换按钮组",
  "trace-float": "模型对话过程浮层",
  "fx-grid": "背景网格",
  "fx-data-rain": "数字雨",
  "fx-scanlines": "扫描线层",
  "fx-vignette": "暗角层",
  "fx-glitch": "故障撕裂特效",
};

// 清单分组（顺序即展示顺序）
export const DEV_GROUPS = [
  { title: "主组件 / 交互", ids: ["fx-spectrum", "fx-bars", "fx-title", "fx-scanbar", "fx-hacker-stream", "chat-panel", "fx-form-switch", "trace-float"] },
  { title: "HUD 面板", ids: ["hud-tr", "hud-bl", "hud-br"] },
  { title: "背景特效（不可移动）", ids: ["fx-ring", "fx-grid", "fx-data-rain", "fx-scanlines", "fx-vignette", "fx-glitch"] },
];
