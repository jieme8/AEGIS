import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 独立「功能流程图」窗口：经 Portal 挂到 body，可在整页任意拖动。
// 交互模型：以「主对话流」为【总关系图】。主干上带 ◳ 的节点可直接下钻到对应支线
// （MCP 工具循环 / 生图管线 / 地图标注）；支线视图顶部有面包屑可返回主干。
// 节点点击：可下钻节点→展开支线；普通节点→复制源码锚点。
// 挂载范式与 ImageWindow / FeatureListWindow 一致：默认关闭、非侵入。

// ── 节点配色（沿用 app 青/品红/琥珀霓虹语言）──────────────────────
const KIND = {
  io:       { stroke: "#36f0c0", label: "输入/输出" },
  proc:     { stroke: "#00f0ff", label: "处理节点" },
  decision: { stroke: "#ffc24d", label: "判定分支" },
  skip:     { stroke: "#ff5d8f", label: "终止/跳过" },
  branch:   { stroke: "#ff3df0", label: "旁路" },
};

// 支线元信息：用于主干上的「下钻入口」标注与配色
const BRANCH = {
  mcp:   { label: "MCP 工具循环", color: "#00f0ff" },
  image: { label: "生图管线",     color: "#ff3df0" },
  map:   { label: "地图标注",     color: "#ffc24d" },
};

const NW = 200; // 节点宽度
const NH = 54;  // 节点高度

// ── 管线定义（坐标手摆，保证可读）──────────────────────────────────
// 主对话流 = 总关系图；其它支线通过主干节点 expand 下钻进入。
const PIPELINES = [
  {
    id: "main",
    label: "主对话流（总关系图）",
    width: 780,
    height: 980,
    nodes: [
      { id: "input",    x: 270, y: 20,  kind: "io",       title: "用户输入",            anchor: "useChatController.handleSend" },
      { id: "moviechk", x: 270, y: 100, kind: "decision", title: "是否 @影视搜索?",     anchor: "runMovieSearchCommand" },
      { id: "movie",    x: 540, y: 100, kind: "proc",     title: "影视搜索检索",        anchor: "movieSearch.searchMovies" },
      { id: "movieout", x: 540, y: 180, kind: "proc",     title: "富结果渲染",          anchor: "renderMovieResults" },
      { id: "mapuser",  x: 270, y: 184, kind: "proc",     title: "位置标注(用户文本)",  anchor: "maybeShowMap", expand: "map" },
      { id: "typing",   x: 270, y: 268, kind: "proc",     title: "打字指示",            anchor: "showTyping" },
      { id: "build",    x: 270, y: 352, kind: "proc",     title: "构建消息(最近12轮)",  anchor: "useChatController" },
      { id: "agent",    x: 270, y: 436, kind: "decision", title: "Agent tool-loop",     anchor: "agentLoop.runAgentLoop", expand: "mcp" },
      { id: "tool",     x: 540, y: 436, kind: "proc",     title: "MCP 工具执行",         anchor: "executeTool" },
      { id: "final",    x: 270, y: 520, kind: "proc",     title: "终态 finalize",       anchor: "useChatController:582" },
      { id: "img",      x: 270, y: 604, kind: "proc",     title: "runImagePipeline",    anchor: "imagePipeline", expand: "image" },
      { id: "mem",      x: 270, y: 688, kind: "proc",     title: "runAutoMemory",       anchor: "autoMemory" },
      { id: "trace",    x: 270, y: 772, kind: "proc",     title: "trace 浮层",          anchor: "setTrace" },
      { id: "mapai",    x: 270, y: 866, kind: "proc",     title: "位置标注(AI文本)",    anchor: "maybeShowMap", expand: "map" },
    ],
    edges: [
      { from: "input", to: "moviechk" },
      { from: "moviechk", to: "movie", label: "是" },
      { from: "moviechk", to: "mapuser", label: "否" },
      { from: "movie", to: "movieout" },
      { from: "movieout", to: "final", label: "跳过LLM", dashed: true },
      { from: "mapuser", to: "typing" },
      { from: "typing", to: "build" },
      { from: "build", to: "agent" },
      { from: "agent", to: "tool", label: "有tool_calls" },
      { from: "agent", to: "final", label: "无" },
      { from: "tool", to: "agent", label: "回填再请求", type: "loop" },
      { from: "final", to: "img" },
      { from: "img", to: "mem" },
      { from: "mem", to: "trace" },
      { from: "trace", to: "mapai" },
    ],
  },
  {
    id: "image",
    label: "生图管线",
    width: 780,
    height: 660,
    nodes: [
      { id: "text",   x: 270, y: 20,  kind: "io",       title: "finalText",              anchor: "useChatController.finalize" },
      { id: "assess", x: 270, y: 100, kind: "decision", title: "价值判定 assessValue",   anchor: "imagePipeline.assessValue" },
      { id: "skip",   x: 540, y: 100, kind: "skip",     title: "跳过生图",               anchor: "阈值未达 judgeThreshold" },
      { id: "judge",  x: 270, y: 184, kind: "proc",     title: "判定消息 appendJudgment",anchor: "imagePipeline" },
      { id: "design", x: 270, y: 268, kind: "proc",     title: "设计视觉方案",           anchor: "imageDesigner.designImagePrompt" },
      { id: "rule",   x: 540, y: 268, kind: "branch",   title: "规则兜底 buildRuleDesign",anchor: "imageDesigner" },
      { id: "gen",    x: 270, y: 352, kind: "proc",     title: "生成 generateImage",     anchor: "imageGenClient.generateImage" },
      { id: "local",  x: 540, y: 352, kind: "proc",     title: "本地 canvas 渲染",       anchor: "localImageRenderer" },
      { id: "http",   x: 540, y: 432, kind: "proc",     title: "/api/genimg 远程",       anchor: "server/image-proxy.mjs" },
      { id: "bridge", x: 270, y: 444, kind: "proc",     title: "事件桥 image-ready",     anchor: "imagePipeline 事件" },
      { id: "win",    x: 270, y: 528, kind: "io",       title: "ImageWindow 配图窗",     anchor: "ImageWindow.jsx" },
    ],
    edges: [
      { from: "text", to: "assess" },
      { from: "assess", to: "skip", label: "否" },
      { from: "assess", to: "judge", label: "是" },
      { from: "judge", to: "design" },
      { from: "design", to: "rule", label: "兜底", dashed: true },
      { from: "design", to: "gen" },
      { from: "gen", to: "local", label: "local" },
      { from: "gen", to: "http", label: "http" },
      { from: "local", to: "bridge" },
      { from: "http", to: "bridge" },
      { from: "bridge", to: "win" },
    ],
  },
  {
    id: "map",
    label: "地图标注",
    width: 700,
    height: 600,
    nodes: [
      { id: "text",  x: 40,  y: 20,  kind: "proc",     title: "文本抽取 extractLocations", anchor: "locationExtractor" },
      { id: "geo1",  x: 40,  y: 104, kind: "proc",     title: "maps_geo 地理编码",          anchor: "mcpClient.callTool" },
      { id: "src1",  x: 40,  y: 188, kind: "proc",     title: "parseGeoMarker",             anchor: "mapParse" },
      { id: "tool",  x: 440, y: 20,  kind: "proc",     title: "AI tool-loop 拦截",          anchor: "executeTool" },
      { id: "geo2",  x: 440, y: 104, kind: "proc",     title: "maps_geo / maps_direction_*",anchor: "agentLoop" },
      { id: "src2",  x: 440, y: 188, kind: "proc",     title: "parseRoute / parseGeoMarker",anchor: "mapParse" },
      { id: "card",  x: 240, y: 280, kind: "proc",     title: "createMapCardElement",       anchor: "MapCard.jsx" },
      { id: "amap",  x: 40,  y: 384, kind: "proc",     title: "高德 JS API 直绘 buildMap",  anchor: "amapJsApi.buildMap" },
      { id: "txt",   x: 440, y: 384, kind: "branch",   title: "文本坐标降级卡片",           anchor: "MapCard 无Key" },
      { id: "dedup", x: 240, y: 480, kind: "proc",     title: "WeakMap 去重",               anchor: "renderedCoords" },
    ],
    edges: [
      { from: "text", to: "geo1" },
      { from: "geo1", to: "src1" },
      { from: "src1", to: "card" },
      { from: "tool", to: "geo2" },
      { from: "geo2", to: "src2" },
      { from: "src2", to: "card" },
      { from: "card", to: "amap", label: "有Key" },
      { from: "card", to: "txt", label: "无Key" },
      { from: "amap", to: "dedup" },
      { from: "txt", to: "dedup" },
    ],
  },
  {
    id: "mcp",
    label: "MCP工具循环",
    width: 700,
    height: 560,
    nodes: [
      { id: "llm",    x: 220, y: 20,  kind: "io",       title: "LLM 返回",              anchor: "streamLongCat" },
      { id: "check",  x: 220, y: 104, kind: "decision", title: "有 tool_calls?",       anchor: "agentLoop" },
      { id: "tools",  x: 220, y: 196, kind: "proc",     title: "取工具列表 getTools",  anchor: "getTools" },
      { id: "exec",   x: 220, y: 280, kind: "proc",     title: "逐个执行 executeTool", anchor: "executeTool" },
      { id: "relay",  x: 220, y: 364, kind: "proc",     title: "callTool → /api/mcp",  anchor: "mcpClient.callTool" },
      { id: "back",   x: 220, y: 448, kind: "proc",     title: "结果回填上下文",        anchor: "agentLoop" },
      { id: "final",  x: 500, y: 196, kind: "io",       title: "final 终态",            anchor: "useChatController" },
    ],
    edges: [
      { from: "llm", to: "check" },
      { from: "check", to: "final", label: "否" },
      { from: "check", to: "tools", label: "是" },
      { from: "tools", to: "exec" },
      { from: "exec", to: "relay" },
      { from: "relay", to: "back" },
      { from: "back", to: "llm", label: "≤N轮 再请求", type: "loop" },
    ],
  },
];

// ── 几何辅助 ───────────────────────────────────────────────────────
const SIDES = {
  top:    (n) => ({ x: n.x + n.__w / 2, y: n.y }),
  bottom: (n) => ({ x: n.x + n.__w / 2, y: n.y + n.__h }),
  left:   (n) => ({ x: n.x, y: n.y + n.__h / 2 }),
  right:  (n) => ({ x: n.x + n.__w, y: n.y + n.__h / 2 }),
};
const DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

function pickSides(a, b) {
  const acx = a.x + a.__w / 2, acy = a.y + a.__h / 2;
  const bcx = b.x + b.__w / 2, bcy = b.y + b.__h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
  return dx > 0 ? ["right", "left"] : ["left", "right"];
}

function edgePath(a, b, type) {
  const [fs, ts] = type === "loop" ? ["right", "right"] : pickSides(a, b);
  const P0 = SIDES[fs](a), P3 = SIDES[ts](b);
  const off = 42;
  if (type === "loop") {
    const c1 = { x: P0.x + off * 1.9, y: P0.y };
    const c2 = { x: P3.x + off * 1.9, y: P3.y };
    return `M${P0.x},${P0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${P3.x},${P3.y}`;
  }
  const [dx1, dy1] = DIR[fs], [dx2, dy2] = DIR[ts];
  const c1 = { x: P0.x + dx1 * off, y: P0.y + dy1 * off };
  const c2 = { x: P3.x + dx2 * off, y: P3.y + dy2 * off };
  return `M${P0.x},${P0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${P3.x},${P3.y}`;
}

function arrowPoints(b, ts) {
  const P3 = SIDES[ts](b);
  const [dx, dy] = DIR[ts];
  const tip = P3;
  const base = { x: P3.x + dx * 11, y: P3.y + dy * 11 };
  const px = -dy, py = dx;
  return [
    tip,
    { x: base.x + px * 5.5, y: base.y + py * 5.5 },
    { x: base.x - px * 5.5, y: base.y - py * 5.5 },
  ];
}

export function FlowDiagramWindow({ open, onClose }) {
  const boxRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [view, setView] = useState({ pipelineId: "main", parentId: null });
  const [hover, setHover] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const diagram = PIPELINES.find((p) => p.id === view.pipelineId) || PIPELINES[0];
  const isMain = view.parentId === null;

  // 给节点挂尺寸与中心，供几何计算
  const nodes = diagram.nodes.map((n) => ({
    ...n,
    __w: NW,
    __h: NH,
    __cx: n.x + NW / 2,
    __cy: n.y + NH / 2,
  }));
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const adj = {}; // node id -> 关联边 index 集合
  diagram.edges.forEach((e, i) => {
    (adj[e.from] ||= new Set()).add(i);
    (adj[e.to] ||= new Set()).add(i);
  });

  // 拖动（与 FeatureListWindow 同款）
  const onHeadPointerDown = (e) => {
    if (e.target.closest(".fl-close")) return;
    const box = boxRef.current;
    if (!box) return;
    const sx = e.clientX, sy = e.clientY;
    const ol = box.offsetLeft, ot = box.offsetTop;
    box.style.right = "auto";
    setDragging(true);
    box.style.userSelect = "none";
    const onMove = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const maxL = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxT = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.max(0, Math.min(ol + dx, maxL)) + "px";
      box.style.top = Math.max(0, Math.min(ot + dy, maxT)) + "px";
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
  const onResizePointerDown = (e) => {
    const box = boxRef.current;
    if (!box) return;
    const sy = e.clientY, oh = box.offsetHeight;
    setResizing(true);
    const onMove = (ev) => {
      const dy = ev.clientY - sy;
      box.style.height = Math.max(260, Math.min(window.innerHeight - 100, oh + dy)) + "px";
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

  const copyAnchor = (anchor) => {
    const done = () => {
      setToast("已复制锚点: " + anchor);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(""), 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(anchor).then(done).catch(done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = anchor;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
      done();
    }
  };

  // 主干视图下：可下钻节点→展开支线；其余→复制锚点
  const onNodeClick = (n) => {
    if (isMain && n.expand) {
      setView({ pipelineId: n.expand, parentId: "main" });
      setHover(null);
    } else {
      copyAnchor(n.anchor);
    }
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  if (!open) return null;

  return createPortal(
    <div
      ref={boxRef}
      className={"flow-window" + (dragging ? " dragging" : "") + (resizing ? " resizing" : "")}
      role="dialog"
      aria-label="流程图窗口"
      data-dev-id="flow-window"
    >
      <div className="fl-head" onPointerDown={onHeadPointerDown}>
        <span className="fl-title">功能流程图</span>
        {!isMain && (
          <div className="flow-crumb">
            <button type="button" className="flow-back" onClick={() => setView({ pipelineId: "main", parentId: null })}>
              ‹ 主对话流
            </button>
            <span className="flow-crumb-sep">/</span>
            <span className="flow-crumb-cur">{diagram.label}</span>
          </div>
        )}
        {isMain && <span className="flow-crumb-cur flow-crumb-root">总关系图（主干）</span>}
        <button className="fl-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="flow-legend">
        {Object.entries(KIND).map(([k, v]) => (
          <span className="flow-legend-item" key={k}>
            <i style={{ background: v.stroke }} />
            {v.label}
          </span>
        ))}
        <span className="flow-legend-hint">◳ 主干带下钻的节点可点击展开支线 · 普通节点点击复制锚点</span>
      </div>

      {diagram.detached && (
        <div className="flow-detached-note">
          ⚠ 此支线与主干「主对话流」无直接触发关系，独立运行。
        </div>
      )}

      <div className="flow-canvas-wrap">
        <svg
          className="flow-svg"
          width={diagram.width}
          height={diagram.height}
          viewBox={`0 0 ${diagram.width} ${diagram.height}`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <pattern id="flowGrid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.1" fill="rgba(0,240,255,0.09)" />
            </pattern>
            {Object.entries(KIND).map(([k, v]) => (
              <linearGradient id={`fg-${k}`} key={k} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={v.stroke} stopOpacity="0.20" />
                <stop offset="1" stopColor={v.stroke} stopOpacity="0.05" />
              </linearGradient>
            ))}
            <filter id="flowGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="flowHalo" cx="50%" cy="40%" r="60%">
              <stop offset="0" stopColor="rgba(0,240,255,0.10)" />
              <stop offset="1" stopColor="rgba(0,240,255,0)" />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width={diagram.width} height={diagram.height} fill="url(#flowGrid)" />
          <rect x="0" y="0" width={diagram.width} height={diagram.height} fill="url(#flowHalo)" />

          {/* 连线 */}
          {diagram.edges.map((e, i) => {
            const a = nodeMap[e.from], b = nodeMap[e.to];
            const [fs, ts] = e.type === "loop" ? ["right", "right"] : pickSides(a, b);
            const d = edgePath(a, b, e.type);
            const hot = hover && adj[hover]?.has(i);
            const col = e.type === "loop" ? "#ffc24d" : KIND[b.kind]?.stroke || "#00f0ff";
            const dim = hover && !hot;
            return (
              <g key={i} className={"flow-edge" + (hot ? " hot" : "")} style={{ color: col }}>
                <path
                  d={d}
                  fill="none"
                  stroke={col}
                  strokeWidth={hot ? 2.8 : 1.8}
                  strokeDasharray={e.dashed ? "6 6" : "none"}
                  strokeLinecap="round"
                  opacity={dim ? 0.16 : 0.9}
                  filter={hot ? "url(#flowGlow)" : undefined}
                />
                <polygon
                  points={arrowPoints(b, ts).map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={col}
                  opacity={dim ? 0.16 : 0.95}
                  filter={hot ? "url(#flowGlow)" : undefined}
                />
                {e.label && (() => {
                  const mx = (a.__cx + b.__cx) / 2 + (e.type === "loop" ? 64 : 0);
                  const my = (a.__cy + b.__cy) / 2;
                  const lw = e.label.length * 6.6 + 12;
                  return (
                    <g className="flow-elabel" opacity={dim ? 0.16 : 1}>
                      <rect
                        x={mx - lw / 2}
                        y={my - 9}
                        width={lw}
                        height={18}
                        rx="9"
                        fill="rgba(3,8,14,0.9)"
                        stroke={col}
                        strokeOpacity={hot ? 0.9 : 0.5}
                        strokeWidth="1"
                      />
                      <text x={mx} y={my + 3.5} className="flow-edge-label" fill={col}>
                        {e.label}
                      </text>
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* 节点 */}
          {nodes.map((n, idx) => {
            const c = KIND[n.kind] || KIND.proc;
            const active = hover === n.id;
            const dim = hover && !active && !adj[hover]?.has(n.id);
            const expandable = isMain && n.expand;
            const br = expandable ? BRANCH[n.expand] : null;
            return (
              <g
                key={n.id}
                className={"flow-node" + (active ? " hot" : "") + (expandable ? " expandable" : "")}
                opacity={dim ? 0.32 : 1}
                onMouseEnter={() => setHover(n.id)}
                onClick={() => onNodeClick(n)}
                style={{ color: c.stroke, cursor: expandable ? "pointer" : "copy", animationDelay: idx * 24 + "ms" }}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={NW}
                  height={NH}
                  rx="12"
                  fill={`url(#fg-${n.kind})`}
                  stroke={expandable ? br.color : c.stroke}
                  strokeWidth={active ? 2.2 : expandable ? 1.8 : 1.3}
                  strokeDasharray={expandable ? "5 4" : "none"}
                  filter={active ? "url(#flowGlow)" : undefined}
                />
                {/* 顶部高光 */}
                <rect
                  x={n.x + 1}
                  y={n.y + 1}
                  width={NW - 2}
                  height={NH / 2}
                  rx="11"
                  fill="rgba(255,255,255,0.05)"
                  pointerEvents="none"
                />
                {/* 左侧色脊 */}
                <rect x={n.x} y={n.y + 8} width="4.5" height={NH - 16} rx="2.2" fill={expandable ? br.color : c.stroke} />
                {/* 类型/下钻圆点 */}
                <circle
                  cx={n.x + NW - 13}
                  cy={n.y + 13}
                  r="3.4"
                  fill={expandable ? br.color : c.stroke}
                  opacity="0.9"
                />
                <text x={n.x + 16} y={n.y + 23} className="flow-node-title" fill="#ecfbff">
                  {n.title}
                </text>
                <text x={n.x + 16} y={n.y + 42} className="flow-node-anchor" fill={expandable ? br.color : c.stroke}>
                  {n.anchor}
                </text>
                {/* 主干视图：可下钻节点在下方标注支线入口 */}
                {expandable && (
                  <g className="flow-node-branch" style={{ color: br.color }}>
                    <rect
                      x={n.x + NW / 2 - 58}
                      y={n.y + NH + 8}
                      width="116"
                      height="20"
                      rx="10"
                      fill="rgba(3,8,14,0.85)"
                      stroke={br.color}
                      strokeOpacity="0.7"
                      strokeWidth="1"
                    />
                    <text x={n.x + NW / 2} y={n.y + NH + 21} className="flow-branch-label" fill={br.color}>
                      ◳ 展开 {br.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="fl-resize" onPointerDown={onResizePointerDown} title="拖动调整高度" />
      {toast && <div className="flow-toast">{toast}</div>}
    </div>,
    document.body
  );
}
