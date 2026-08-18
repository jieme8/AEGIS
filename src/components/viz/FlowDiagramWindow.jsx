import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 独立「功能流程图」窗口：经 Portal 挂到 body，可在整页任意拖动。
// 交互模型：以「主对话流」为【总关系图】。主干上带 ◳ 的节点可直接下钻到对应支线
// （MCP 工具循环 / 生图管线 / 地图标注）；支线视图顶部有面包屑可返回主干。
// 节点点击：可下钻节点→展开支线；普通节点→复制源码锚点。
// 视觉：工程示意图风——深底卡片 + 1px 描边 + 左侧细色条，去掉霓虹光晕/halo。
// 挂载范式与 ImageWindow / FeatureListWindow 一致：默认关闭、非侵入。

// ── 节点配色（去掉 glow，主色作描边与左侧色条）──────────────────
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
const NH = 58;  // 节点高度（加高 8px，给标题和锚点留足呼吸）

// ── 管线定义（坐标手摆，保证可读）──────────────────────────────────
// 标题只放中文概念（≤8 字），英文/方法名统一放锚点行——保证不超框。
const PIPELINES = [
  {
    id: "main",
    label: "主对话流（总关系图）",
    width: 900,
    height: 1060,
    nodes: [
      { id: "input",    x: 270, y: 20,  kind: "io",       title: "用户输入",            anchor: "handleSend" },
      { id: "moviechk", x: 270, y: 110, kind: "decision", title: "是否 @影视搜索?",     anchor: "runMovieSearchCommand" },
      { id: "movie",    x: 540, y: 110, kind: "proc",     title: "影视搜索",            anchor: "movieSearch.searchMovies" },
      { id: "movieout", x: 540, y: 580, kind: "proc",     title: "富结果渲染",          anchor: "renderMovieResults" },
      { id: "mapuser",  x: 270, y: 204, kind: "proc",     title: "位置标注(用户)",      anchor: "maybeShowMap", expand: "map" },
      { id: "typing",   x: 270, y: 298, kind: "proc",     title: "打字指示",            anchor: "showTyping" },
      { id: "build",    x: 270, y: 392, kind: "proc",     title: "构建消息",            anchor: "buildMessages" },
      { id: "agent",    x: 270, y: 486, kind: "decision", title: "Agent tool-loop",     anchor: "agentLoop.runAgentLoop", expand: "mcp" },
      { id: "tool",     x: 540, y: 486, kind: "proc",     title: "工具执行",            anchor: "executeTool" },
      { id: "final",    x: 270, y: 580, kind: "proc",     title: "终态 finalize",       anchor: "useChatController:582" },
      { id: "img",      x: 270, y: 674, kind: "proc",     title: "AI 生图",             anchor: "runImagePipeline", expand: "image" },
      { id: "mem",      x: 270, y: 768, kind: "proc",     title: "自动记忆",            anchor: "runAutoMemory" },
      { id: "trace",    x: 270, y: 862, kind: "proc",     title: "trace 浮层",          anchor: "setTrace" },
      { id: "mapai",    x: 270, y: 956, kind: "proc",     title: "位置标注(AI)",        anchor: "maybeShowMap", expand: "map" },
    ],
    edges: [
      { from: "input", to: "moviechk" },
      { from: "moviechk", to: "movie", label: "是" },
      { from: "moviechk", to: "mapuser", label: "否" },
      { from: "movie", to: "movieout" },
      { from: "movieout", to: "final", label: "跳过 LLM", dashed: true, sides: ["left", "right"] },
      { from: "mapuser", to: "typing" },
      { from: "typing", to: "build" },
      { from: "build", to: "agent" },
      { from: "agent", to: "tool", label: "有 tool_calls" },
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
      { id: "text",   x: 270, y: 20,  kind: "io",       title: "finalText",         anchor: "finalize" },
      { id: "assess", x: 270, y: 100, kind: "decision", title: "价值判定",          anchor: "imagePipeline.assessValue" },
      { id: "skip",   x: 540, y: 100, kind: "skip",     title: "跳过生图",          anchor: "阈值未达 judgeThreshold" },
      { id: "judge",  x: 270, y: 184, kind: "proc",     title: "判定消息",          anchor: "appendJudgment" },
      { id: "design", x: 270, y: 268, kind: "proc",     title: "设计视觉方案",      anchor: "designImagePrompt" },
      { id: "rule",   x: 540, y: 268, kind: "branch",   title: "规则兜底",          anchor: "imageDesigner.buildRuleDesign" },
      { id: "gen",    x: 270, y: 352, kind: "proc",     title: "生成",              anchor: "generateImage" },
      { id: "local",  x: 540, y: 352, kind: "proc",     title: "本地渲染",          anchor: "localImageRenderer" },
      { id: "http",   x: 540, y: 432, kind: "proc",     title: "远程生成",          anchor: "server/image-proxy.mjs" },
      { id: "bridge", x: 270, y: 444, kind: "proc",     title: "事件桥",            anchor: "image-ready" },
      { id: "win",    x: 270, y: 528, kind: "io",       title: "配图窗",            anchor: "ImageWindow.jsx" },
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
      { id: "text",  x: 40,  y: 20,  kind: "proc",     title: "文本抽取",          anchor: "extractLocations" },
      { id: "geo1",  x: 40,  y: 104, kind: "proc",     title: "地理编码",          anchor: "maps_geo" },
      { id: "src1",  x: 40,  y: 188, kind: "proc",     title: "parseGeoMarker",    anchor: "mapParse" },
      { id: "tool",  x: 440, y: 20,  kind: "proc",     title: "AI 拦截",           anchor: "executeTool" },
      { id: "geo2",  x: 440, y: 104, kind: "proc",     title: "maps_* 工具",       anchor: "maps_geo / direction" },
      { id: "src2",  x: 440, y: 188, kind: "proc",     title: "parseRoute",        anchor: "mapParse parseRoute" },
      { id: "card",  x: 240, y: 280, kind: "proc",     title: "createMapCard",     anchor: "MapCard.jsx" },
      { id: "amap",  x: 40,  y: 384, kind: "proc",     title: "高德直绘",          anchor: "amapJsApi.buildMap" },
      { id: "txt",   x: 440, y: 384, kind: "branch",   title: "降级卡片",          anchor: "MapCard 无 Key" },
      { id: "dedup", x: 240, y: 480, kind: "proc",     title: "WeakMap 去重",      anchor: "renderedCoords" },
    ],
    edges: [
      { from: "text", to: "geo1" },
      { from: "geo1", to: "src1" },
      { from: "src1", to: "card" },
      { from: "tool", to: "geo2" },
      { from: "geo2", to: "src2" },
      { from: "src2", to: "card" },
      { from: "card", to: "amap", label: "有 Key" },
      { from: "card", to: "txt", label: "无 Key" },
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
      { id: "llm",    x: 220, y: 20,  kind: "io",       title: "LLM 返回",          anchor: "streamLongCat" },
      { id: "check",  x: 220, y: 104, kind: "decision", title: "有 tool_calls?",   anchor: "agentLoop" },
      { id: "tools",  x: 220, y: 196, kind: "proc",     title: "取工具列表",        anchor: "getTools" },
      { id: "exec",   x: 220, y: 280, kind: "proc",     title: "逐个执行",          anchor: "executeTool" },
      { id: "relay",  x: 220, y: 364, kind: "proc",     title: "callTool",          anchor: "mcpClient.callTool" },
      { id: "back",   x: 220, y: 448, kind: "proc",     title: "回填上下文",        anchor: "agentLoop" },
      { id: "final",  x: 500, y: 196, kind: "io",       title: "终态",              anchor: "useChatController" },
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

// ── 小工具：把 #rrggbb 转成 "r,g,b" 供 rgba() 使用 ───────────────
function hexToRgbStr(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

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

function edgePath(a, b, type, sides) {
  const [fs, ts] = type === "loop" ? ["right", "right"] : (sides || pickSides(a, b));
  const P0 = SIDES[fs](a), P3 = SIDES[ts](b);
  const off = 42;
  if (type === "loop") {
    // loop 真正向上鼓起，避免画成直线；文字会沿曲线走，归属清晰
    const c1 = { x: P0.x + off * 1.9, y: P0.y - 40 };
    const c2 = { x: P3.x + off * 1.9, y: P3.y - 40 };
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
  const base = { x: P3.x + dx * 9, y: P3.y + dy * 9 };
  const px = -dy, py = dx;
  return [
    tip,
    { x: base.x + px * 4.5, y: base.y + py * 4.5 },
    { x: base.x - px * 4.5, y: base.y - py * 4.5 },
  ];
}

// 边标签位置：紧贴连线中点、刚好不压节点，并返回引线起点
// 关键：只有「真·水平」(|dy|<=12) 与「真·垂直」(|dx|<=12) 走固定分支；
// 其余一律当【斜边】处理——放到连线中点、沿法向偏移、再避让 a/b 节点框，
// 否则斜边（如 gen→http、card→amap）会被误判成水平边、标签压进源节点。
function labelPos(a, b, type, text) {
  const halfW = text.length * 3.2 + 7;
  const halfH = 9;
  const gap = 6;
  const mx = (a.__cx + b.__cx) / 2;
  const my = (a.__cy + b.__cy) / 2;

  if (type === "loop") {
    const P0 = SIDES.right(a), P3 = SIDES.right(b);
    const mid = { x: P0.x + 42 * 1.9, y: (P0.y + P3.y) / 2 };
    // 标签放到 loop 鼓出曲线右上方，引线斜向更可见
    return { x: mid.x + halfW + gap, y: mid.y - halfH - gap, mid };
  }

  const dx = b.__cx - a.__cx;
  const dy = b.__cy - a.__cy;

  // 真·水平边：标签放到连线中点上方，底边贴节点顶 gap
  if (Math.abs(dy) <= 12) {
    const y = Math.min(a.y, b.y) - halfH - gap;
    return { x: mx, y, mid: { x: mx, y: my } };
  }

  // 真·垂直边：标签放在源节点底 / 目标节点顶之间的间隙中点，
  // 并贴到节点列左侧（右边缘离节点左边缘 gap），通过引线才能看出归属
  if (Math.abs(dx) <= 12) {
    const top = Math.max(a.y + a.__h, b.y);     // 下方节点顶
    const bottom = Math.min(a.y + a.__h, b.y);  // 上方节点底
    const y = (top + bottom) / 2;
    const x = Math.min(a.x, b.x) - halfW - gap;
    return { x, y, mid: { x: mx, y } };
  }

  // 斜边：中点 + 法向偏移，矩形不压 a/b 节点
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; } // 偏上方/外侧
  const rect = (lx, ly) => ({ l: lx - halfW, r: lx + halfW, t: ly - halfH, b: ly + halfH });
  const overlap = (r, n) =>
    !(r.r < n.x - gap || r.l > n.x + n.__w + gap || r.b < n.y - gap || r.t > n.y + n.__h + gap);
  let d = Math.max(halfW, halfH) + gap;
  let lx = mx, ly = my;
  for (let i = 0; i < 16; i++) {
    lx = mx + nx * d;
    ly = my + ny * d;
    const r = rect(lx, ly);
    if (!overlap(r, a) && !overlap(r, b)) break;
    d += 10;
  }
  return { x: lx, y: ly, mid: { x: mx, y: my } };
}

export function FlowDiagramWindow({ open, onClose }) {
  const boxRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [view, setView] = useState({ pipelineId: "main", parentId: null, fromNode: null });
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
      setView({
        pipelineId: n.expand,
        parentId: "main",
        fromNode: { id: n.id, title: n.title },
      });
      setHover(null);
    } else {
      copyAnchor(n.anchor);
    }
  };
  const goBack = () => setView({ pipelineId: "main", parentId: null, fromNode: null });

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
            <button type="button" className="flow-back" onClick={goBack} title="返回主对话流">
              ‹ 主对话流
            </button>
            <span className="flow-crumb-sep">/</span>
            {view.fromNode && (
              <>
                <span className="flow-crumb-from" title="下钻来源节点">
                  从 <b>{view.fromNode.title}</b>
                </span>
                <span className="flow-crumb-sep">›</span>
              </>
            )}
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
        <span className="flow-legend-hint">▾ 虚线框 = 可下钻（点击或下方标签）· 普通节点点击复制源码锚点</span>
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
              <circle cx="2" cy="2" r="1" fill="rgba(0,240,255,0.07)" />
            </pattern>
            <filter id="flowGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect x="0" y="0" width={diagram.width} height={diagram.height} fill="url(#flowGrid)" />

          {/* 连线 */}
          {diagram.edges.map((e, i) => {
            const a = nodeMap[e.from], b = nodeMap[e.to];
            const sides = e.type === "loop" ? null : (e.sides || pickSides(a, b));
            const [fs, ts] = e.type === "loop" ? ["right", "right"] : sides;
            const d = edgePath(a, b, e.type, sides);
            const hot = hover && adj[hover]?.has(i);
            const col = e.type === "loop" ? "#ffc24d" : KIND[b.kind]?.stroke || "#00f0ff";
            const dim = hover && !hot;
            return (
              <g key={i} className={"flow-edge" + (hot ? " hot" : "")} style={{ color: col }}>
                <path
                  d={d}
                  fill="none"
                  stroke={col}
                  strokeWidth={hot ? (e.type === "loop" ? 2.2 : 1.8) : (e.type === "loop" ? 1.8 : 1.2)}
                  strokeDasharray={e.dashed ? "4 4" : "none"}
                  strokeLinecap="round"
                  opacity={dim ? 0.18 : (e.type === "loop" ? 0.85 : 0.7)}
                />
                <polygon
                  points={arrowPoints(b, ts).map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={col}
                  opacity={dim ? 0.18 : 0.85}
                />
                {e.label && (() => {
                  if (e.type === "loop") {
                    // loop 标签沿曲线本身走，不再用独立小框
                    const pathId = `loopLabelPath-${i}`;
                    return (
                      <g className="flow-elabel" opacity={dim ? 0.18 : 1}>
                        <path id={pathId} d={d} fill="none" stroke="none" />
                        <text className="flow-edge-label" fill={col} fontSize="11" fontWeight="600">
                          <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle" dy="-7">
                            {e.label}
                          </textPath>
                        </text>
                      </g>
                    );
                  }
                  const { x: mx, y: my, mid } = labelPos(a, b, e.type, e.label);
                  const lw = e.label.length * 6.4 + 14;
                  return (
                    <g className="flow-elabel" opacity={dim ? 0.18 : 1}>
                      <line
                        x1={mid.x}
                        y1={mid.y}
                        x2={mx}
                        y2={my}
                        stroke={col}
                        strokeOpacity={dim ? 0.18 : 0.45}
                        strokeWidth="1"
                        strokeDasharray="2 2"
                      />
                      <rect
                        x={mx - lw / 2}
                        y={my - 9}
                        width={lw}
                        height="18"
                        rx="4"
                        fill="rgba(8,14,22,0.98)"
                        stroke={col}
                        strokeOpacity={hot ? 0.9 : 0.45}
                        strokeWidth="1"
                      />
                      <text x={mx} y={my + 3.2} className="flow-edge-label" fill={col}>
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
            const accent = expandable ? br.color : c.stroke;
            return (
              <g
                key={n.id}
                className={"flow-node" + (active ? " hot" : "") + (expandable ? " expandable" : "")}
                opacity={dim ? 0.4 : 1}
                onMouseEnter={() => setHover(n.id)}
                onClick={() => onNodeClick(n)}
                style={{ cursor: expandable ? "pointer" : "copy", animationDelay: idx * 24 + "ms" }}
              >
                {expandable && (
                  <title>{`${n.title} → 点击展开：${br.label}`}</title>
                )}
                <rect
                  x={n.x}
                  y={n.y}
                  width={NW}
                  height={NH}
                  rx="6"
                  fill={expandable ? "rgba(" + hexToRgbStr(br.color) + ",0.06)" : "rgba(8,14,22,0.92)"}
                  stroke={accent}
                  strokeOpacity={active ? 1 : expandable ? 0.85 : 0.65}
                  strokeWidth={active ? 1.5 : expandable ? 1.3 : 1}
                  strokeDasharray={expandable ? (active ? "none" : "4 3") : "none"}
                  filter={active ? "url(#flowGlow)" : undefined}
                />
                {/* 左侧色条 */}
                <rect x={n.x} y={n.y + 8} width="3" height={NH - 16} rx="1.5" fill={accent} fillOpacity="0.9" />
                {/* 可下钻节点右上角箭头提示 */}
                {expandable && (
                  <g pointerEvents="none">
                    <path
                      d={`M ${n.x + NW - 17} ${n.y + 11} l 6 6 l -6 6`}
                      fill="none" stroke={br.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"
                    />
                  </g>
                )}
                <text x={n.x + 14} y={n.y + 22} className="flow-node-title">
                  {n.title}
                </text>
                <text x={n.x + 14} y={n.y + 42} className="flow-node-anchor" fill={accent}>
                  {n.anchor}
                </text>
                {/* 主干视图：可下钻节点在下方标注支线入口（更明显的药丸） */}
                {expandable && (
                  <g className="flow-node-branch">
                    <rect
                      x={n.x + NW / 2 - 62}
                      y={n.y + NH + 8}
                      width="124"
                      height="20"
                      rx="4"
                      fill={"rgba(" + hexToRgbStr(br.color) + ",0.18)"}
                      stroke={br.color}
                      strokeOpacity={active ? 1 : 0.7}
                      strokeWidth={active ? 1.2 : 1}
                    />
                    <text x={n.x + NW / 2} y={n.y + NH + 18} className="flow-branch-label" fill={br.color}>
                      ▾ 展开 {br.label}
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
