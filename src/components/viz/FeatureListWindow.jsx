import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IMAGE_CONFIG } from "../../config/imageConfig.js";
import { imageProviderManager } from "../../lib/imageProviderManager.js";
import { aspectManager } from "../../lib/aspectManager.js";
import { MODEL_CONFIG } from "../../config/modelConfig.js";
import { providerManager } from "../../lib/providerManager.js";
import { hasAmapKey } from "../../lib/amapJsApi.js";
import { AT_COMMANDS } from "../../lib/movieSearch.js";

// 独立「功能清单」窗口：经 Portal 挂到 body，可在整页任意拖动。
// 只读清单：枚举 chat-panel 当前所有附加功能，并实时反映其开启状态 / 关键配置 / 源码锚点，
// 便于与 AI agent 沟通「具体改哪个功能」。挂载范式与 ImageWindow / McpPanel 一致。

// 构造清单数据（读取各模块运行时状态，渲染时计算一次即可）。
function buildFeatureGroups() {
  const activeChat = providerManager.getActive();
  const imgActive = imageProviderManager.getActive();
  const hasKey = !!(activeChat && activeChat.apiKey);
  const cyberFxOn = typeof window !== "undefined" && !!window.CyberFx;

  return [
    {
      title: "对话核心",
      items: [
        {
          name: "实时流式对话",
          desc: "经 /api/longcat 调真实大模型（OpenAI 兼容 SSE 流式）",
          on: hasKey,
          detail: activeChat ? `${activeChat.label} · ${activeChat.model}` : "未配置可用密钥",
          src: "useChatController.streamLongCat",
        },
        {
          name: "多供应商切换",
          desc: "LongCat / 阿里 Qwen 整组 endpoint+apiKey+model 切换",
          on: providerManager.hasProfiles(),
          detail: `${providerManager.list().length} 个供应商可用`,
          src: "lib/providerManager.js",
        },
        {
          name: "对话历史持久化",
          desc: "localStorage 保存最近对话，刷新可回放",
          on: true,
          detail: "key: cyber-chat-history-v1",
          src: "useChatController.loadHistory",
        },
        {
          name: "一键复制",
          desc: "气泡正文复制 + AI 回复内 URL 单独复制",
          on: true,
          detail: "clipboard + execCommand 兜底",
          src: "useChatController.copyText",
        },
        {
          name: "过程可视化 (对话流)",
          desc: "展示 请求→上下文→提示词→流式回复→工具调用",
          on: true,
          detail: "TracePanels 浮层",
          src: "components/chat/TracePanels.jsx",
        },
        {
          name: "思考 / 输出特效",
          desc: "接入音频可视化引擎的形态切换（thinking/output/idle）",
          on: cyberFxOn,
          detail: cyberFxOn ? "已挂载" : "未挂载",
          src: "useChatController.CyberFx",
        },
      ],
    },
    {
      title: "输入增强",
      items: [
        {
          name: "@ 指令下拉",
          desc: "输入框 @ 弹出指令选择，↑↓/Enter/Tab 选择",
          on: AT_COMMANDS.length > 0,
          detail: `共 ${AT_COMMANDS.length} 条指令`,
          src: "lib/movieSearch.js · AT_COMMANDS",
        },
        {
          name: "影视搜索指令",
          desc: "@影视搜索 <名称> 分层检索磁力 / 网盘直链",
          on: AT_COMMANDS.some((c) => c.id === "movie-search"),
          detail: "Node 代理 + 分阶段进度条",
          src: "lib/movieSearch.js",
        },
      ],
    },
    {
      title: "智能能力",
      items: [
        {
          name: "MCP 工具调用",
          desc: "Agent tool-loop：检测 tool_calls → 执行 → 回填",
          on: !!(MODEL_CONFIG.toolsEnabled && MODEL_CONFIG.supportsTools),
          detail: `Relay: ${MODEL_CONFIG.mcpRelay || "—"}`,
          src: "lib/agentLoop.js",
        },
        {
          name: "自动记忆",
          desc: "对话结束后提炼用户长期事实写入 memory",
          on: true,
          detail: "fire-and-forget 旁路",
          src: "lib/autoMemory.js",
        },
      ],
    },
    {
      title: "附加生成",
      items: [
        {
          name: "AI 生图",
          desc: "价值判定 → 设计 → 生图，推到独立配图窗口",
          on: IMAGE_CONFIG.enabled,
          detail: `provider=${IMAGE_CONFIG.provider} · ${imgActive?.label || "—"} · 优化=${IMAGE_CONFIG.optimizer}`,
          src: "lib/imagePipeline.js",
        },
        {
          name: "生图价值判定",
          desc: "纯前端规则判定是否值得生图（对话流内可见）",
          on: IMAGE_CONFIG.enabled && IMAGE_CONFIG.showJudgment,
          detail: `阈值 ${IMAGE_CONFIG.judgeThreshold} · 最小 ${IMAGE_CONFIG.minChars} 字`,
          src: "lib/imagePipeline.js · assessValue",
        },
        {
          name: "生图比例",
          desc: "横版 / 竖版比例选择，随请求下发服务端",
          on: aspectManager.hasOptions(),
          detail: `当前 ${aspectManager.getActive()} · ${aspectManager.list().length} 档`,
          src: "lib/aspectManager.js",
        },
        {
          name: "地图自动标注",
          desc: "文本抽取 / AI tool-loop 两条来源自动出地图卡",
          on: true,
          detail: hasAmapKey() ? "高德 JS API 已配置（直绘）" : "无 Key → 文本坐标降级",
          src: "lib/mapParse.js · MapCard.jsx",
        },
      ],
    },
  ];
}

export function FeatureListWindow({ open, onClose }) {
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const groups = buildFeatureGroups();

  // 标题栏拖动（与 ImageWindow 同款：浮层为 body 级，全页可拖）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".fl-close")) return;
    const box = boxRef.current;
    if (!box) return;
    const startX = e.clientX,
      startY = e.clientY;
    const origLeft = box.offsetLeft,
      origTop = box.offsetTop;
    box.style.right = "auto";
    setDragging(true);
    box.style.userSelect = "none";
    const onMove = (ev) => {
      const dx = ev.clientX - startX,
        dy = ev.clientY - startY;
      const maxLeft = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.max(0, Math.min(origLeft + dx, maxLeft)) + "px";
      box.style.top = Math.max(0, Math.min(origTop + dy, maxTop)) + "px";
    };
    const onUp = () => {
      setDragging(false);
      box.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  // 底部 resize 拖拽：调整窗口高度
  const onResizePointerDown = (e) => {
    const box = boxRef.current;
    if (!box) return;
    const startY = e.clientY;
    const origH = box.offsetHeight;
    setResizing(true);
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      const newH = Math.max(220, Math.min(window.innerHeight - 100, origH + dy));
      box.style.height = newH + "px";
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  if (!open) return null;

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const enabled = groups.reduce((n, g) => n + g.items.filter((i) => i.on).length, 0);

  return createPortal(
    <div
      ref={boxRef}
      className={"feat-window" + (dragging ? " dragging" : "") + (resizing ? " resizing" : "")}
      role="dialog"
      aria-label="功能清单窗口"
      data-dev-id="feature-window"
    >
      <div className="fl-head" onPointerDown={onHeadPointerDown}>
        <span className="fl-title">功能清单</span>
        <span className="fl-count">
          {enabled}/{total} 已启用
        </span>
        <button className="fl-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="fl-body" ref={bodyRef}>
        {groups.map((g) => (
          <section className="fl-group" key={g.title}>
            <div className="fl-group-title">{g.title}</div>
            {g.items.map((it) => (
              <div className="fl-item" key={it.name} data-dev-id="feat-item">
                <div className="fl-item-head">
                  <span className={"fl-dot " + (it.on ? "on" : "off")} />
                  <span className="fl-name">{it.name}</span>
                  <span className="fl-state">{it.on ? "已启用" : "已停用"}</span>
                </div>
                <div className="fl-desc">{it.desc}</div>
                <div className="fl-meta">
                  <span className="fl-detail">{it.detail}</span>
                  <span className="fl-src">{it.src}</span>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <div className="fl-resize" onPointerDown={onResizePointerDown} title="拖动调整高度" />
    </div>,
    document.body
  );
}
