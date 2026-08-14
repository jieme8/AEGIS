// 组件 ID → 中文名（用于悬停读数 / 清单，方便向智能体精准指代）
export const DEV_NAMES = {
  "fx-scanbar": "移动扫描光带",
  "fx-spectrum": "频谱可视化画布",
  "fx-title": "顶部故障标题",
  "hud-bl": "左下 HUD · 能量/峰值/单位/频段/频率/增益",
  "task-bar": "底部任务栏 · 功能/组件入口",
  "fx-hacker-stream": "左侧黑客数据流",
  "chat-panel": "主对话窗口",
  "fx-ring": "中央环形波形",
  "fx-bars": "底部频谱柱阵列",
  "fx-form-switch": "形态切换按钮组",
  "fx-grid": "背景网格",
  "fx-data-rain": "数字雨",
  "fx-scanlines": "扫描线层",
  "fx-vignette": "暗角层",
  "fx-glitch": "故障撕裂特效",
  "oil-price-panel": "油价行情卡片",
  "mcp-panel": "MCP 服务器列表",
  "mcp-toggle": "MCP 切换按钮",
  "dev-legend": "组件清单面板",
  "trace-request-status": "对话流-01请求状态",
  "trace-context": "对话流-02附加上下文",
  "trace-prompt": "对话流-03提示词",
  "trace-reasoning": "对话流-04思考过程",
  "trace-mcp-tools": "对话流-05工具调用",
};

// 清单分组（顺序即展示顺序）
export const DEV_GROUPS = [
  { title: "主组件 / 交互", ids: ["fx-spectrum", "fx-bars", "fx-title", "fx-scanbar", "fx-hacker-stream", "chat-panel", "fx-form-switch"] },
  { title: "HUD 面板", ids: ["hud-bl", "task-bar"] },
  { title: "背景特效（不可移动）", ids: ["fx-ring", "fx-grid", "fx-data-rain", "fx-scanlines", "fx-vignette", "fx-glitch"] },
  { title: "数据面板 / 浮层", ids: ["oil-price-panel", "mcp-panel", "mcp-toggle", "dev-legend"] },
  { title: "模型对话过程（独立浮层）", ids: ["trace-request-status", "trace-context", "trace-prompt", "trace-reasoning", "trace-mcp-tools"] },
];
