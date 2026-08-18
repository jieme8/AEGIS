import { useEffect, useRef, useState } from "react";
import { useVizEngine } from "./hooks/useVizEngine.js";
import { useDraggableHud } from "./hooks/useDraggableHud.js";
import {
  BackgroundGrid,
  BackgroundGlow,
  BackgroundVignette,
  Scanlines,
  ScanBar,
} from "./components/background/Background.jsx";
import { SpectrumCanvas } from "./components/viz/SpectrumCanvas.jsx";
import { TitleBar } from "./components/viz/TitleBar.jsx";
import { FormSwitchButtons } from "./components/viz/FormSwitchButtons.jsx";
import { SettingsPanel } from "./components/viz/SettingsPanel.jsx";
import { TaskBar } from "./components/viz/TaskBar.jsx";
import { HackerStreamZone } from "./components/viz/HackerStreamZone.jsx";
import { RingHotZone, BarsHotZone } from "./components/viz/DevZones.jsx";
import { Hud, ChatToggle, McpToggle, ScreenSizeBadge } from "./components/hud/Hud.jsx";
import { ChatPanel } from "./components/chat/ChatPanel.jsx";
import { McpPanel } from "./components/mcp/McpPanel.jsx";
import { ImageWindow } from "./components/viz/ImageWindow.jsx";
import { MapWindow } from "./components/viz/MapWindow.jsx";
import { MapErrorBoundary } from "./components/viz/MapErrorBoundary.jsx";
import { FeatureListWindow } from "./components/viz/FeatureListWindow.jsx";
import { FlowDiagramWindow } from "./components/viz/FlowDiagramWindow.jsx";
import { WebViewerWindow } from "./components/viz/WebViewerWindow.jsx";
import { DevOverlay } from "./components/dev/DevOverlay.jsx";
import { OilPricePanel } from "./components/data/OilPricePanel.jsx";
import { useOilPrice } from "./lib/oilPrice.js";
import { BootOverlay } from "./components/boot/BootOverlay.jsx";
import { WEBVIEWER_EVENT } from "./lib/webViewer.js";
import { BOOT_MS, SEQUENCE } from "./lib/bootTimeline.js";

// 入场时序 el → 真实 DOM 选择器（与 bootTimeline.SEQUENCE 一一对应）
const SEQ_SELECTOR = {
  title: ".title-wrap",
  stage: "#stage",
  "form-switch": ".form-switch",
  hacker: ".hacker-drag-zone",
  "hud-bl": ".hud.bl",
  "task-bar": ".task-bar",
  oil: ".oil-dock",
  chat: ".chat-panel",
};

export default function App() {
  // 启动可视化引擎（canvas 渲染 / 形态切换 / 黑客流拖拽），挂载于根组件，仅初始化一次。
  useVizEngine();

  // 编辑态可拖拽：形态切换按钮组 + 三个角落 HUD（仅 dev-mode 生效）
  useDraggableHud();

  // 启动序列状态：booted=进入主界面（body.booted 触发组件错落入场）；
  // bootGone=遮罩已退场可卸载。
  const [booted, setBooted] = useState(false);
  const [bootGone, setBootGone] = useState(false);
  // 油价卡实时数据：从同源 /api/oil 拉取真实 92# 零售价（失败回退占位值）
  const oil = useOilPrice();
  // MCP 浮层默认显示：用户要求启动即展示服务器列表，并实时反映本轮会话用到的工具。
  const [mcpOpen, setMcpOpen] = useState(true);
  const [activeTask, setActiveTask] = useState("task-image");
  // 地图浮窗独立开关（与 activeTask 解耦，地图可独立开合）；默认关闭
  const [mapOpen, setMapOpen] = useState(false);
  // 功能清单浮窗独立开关（与 activeTask 解耦，开清单不再误关配图窗）
  const [featuresOpen, setFeaturesOpen] = useState(false);
  // 功能流程图浮窗独立开关（与清单同范式，默认关闭、非侵入）
  const [flowOpen, setFlowOpen] = useState(false);
  // 设置窗口开合状态：点击任务栏「设置」打开，窗口内可关闭
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 网页查看器：每个网页单独一个独立浮层（单窗单页）；再来一个网页再弹一个新窗口。
  // 由 jarvis:open-url 事件驱动；手动（任务栏「网页」）也会弹出新窗口。
  const [viewers, setViewers] = useState([]); // [{ id, url, x, y, open }]
  const viewerSeq = useRef(0);
  const spawnViewer = (url) => {
    setViewers((prev) => {
      const last = prev.length ? prev[prev.length - 1] : null;
      const base = last ? { x: last.x + 35, y: last.y + 20 } : { x: 410, y: 120 };
      return [
        ...prev,
        {
          id: "wv-" + (++viewerSeq.current),
          url: url || "",
          x: base.x,
          y: base.y,
          open: true,
        },
      ];
    });
  };
  const closeViewer = (id) => {
    setViewers((prev) => prev.map((v) => (v.id === id ? { ...v, open: false } : v)));
    setTimeout(() => setViewers((prev) => prev.filter((v) => v.id !== id)), 360);
  };

  useEffect(() => {
    // 注入各组件入场时序变量（--delay/--dur/--ease），由 CSS 消费
    SEQUENCE.forEach((s) => {
      const node = document.querySelector(SEQ_SELECTOR[s.el]);
      if (!node) return;
      node.style.setProperty("--delay", s.at + "ms");
      node.style.setProperty("--dur", s.dur + "ms");
      node.style.setProperty("--ease", s.ease);
    });
    // BOOT 结束 → 给 body 加 .booted，组件统一错落浮现
    const t = setTimeout(() => {
      document.body.classList.add("booted");
      setBooted(true);
    }, BOOT_MS);
    return () => clearTimeout(t);
  }, []);

  // 首个配图生成时自动打开独立窗口（不抢占用户对其它任务的选中态）
  useEffect(() => {
    const onStart = () => setActiveTask((t) => (t === "task-image" ? t : "task-image"));
    window.addEventListener("jarvis:image-start", onStart);
    return () => window.removeEventListener("jarvis:image-start", onStart);
  }, []);

  // 首次位置标注时自动打开地图窗口
  useEffect(() => {
    const onMapStart = () => setMapOpen(true);
    window.addEventListener("jarvis:map-start", onMapStart);
    return () => window.removeEventListener("jarvis:map-start", onMapStart);
  }, []);

  // 清空对话时不关闭配图窗（image 由 activeTask 控制，保留默认打开）；
  // 仅同步关闭功能清单浮窗（与 activeTask 解耦的独立开关）。
  useEffect(() => {
    const onCloseAll = () => { setFeaturesOpen(false); };
    window.addEventListener("jarvis:close-all-panels", onCloseAll);
    return () => window.removeEventListener("jarvis:close-all-panels", onCloseAll);
  }, []);

  // 点击遮罩跳过启动（提前进入主界面）
  const skip = () => {
    if (booted) return;
    document.body.classList.add("booted");
    setBooted(true);
  };

  // 监听网页查看器事件：AI 回复链接 / 自动提取的 URL → 每个网址弹出一个独立窗口，
  // 多个网址时按 0.5s 间隔依次打开（一个个弹出，而非同时铺开）
  useEffect(() => {
    const onOpen = (e) => {
      const urls = (e.detail && e.detail.urls) || [];
      if (!urls.length) return;
      urls.forEach((u, i) => {
        setTimeout(() => {
          setViewers((prev) => {
            const out = [...prev].filter((v) => v.open);
            if (out.some((v) => v.url === u)) return prev;
            const last = out.length ? out[out.length - 1] : null;
            const base = last ? { x: last.x + 35, y: last.y + 20 } : { x: 410, y: 120 };
            return [...prev, {
              id: "wv-" + (++viewerSeq.current),
              url: u, x: base.x, y: base.y, open: true,
            }];
          });
        }, i * 500);
      });
    };
    window.addEventListener(WEBVIEWER_EVENT, onOpen);
    return () => window.removeEventListener(WEBVIEWER_EVENT, onOpen);
  }, []);

  return (
    <>
      {/* 背景层 */}
      <BackgroundGrid />
      <BackgroundGlow />
      <BackgroundVignette />
      <Scanlines />
      <ScanBar />

      {/* 可视化主体 + 热区 */}
      <SpectrumCanvas />
      <RingHotZone />
      <BarsHotZone />

      {/* 顶部标题 + 形态切换 + 黑客数据流 */}
      <TitleBar />
      <FormSwitchButtons />
      <HackerStreamZone />

      {/* 角落 HUD 面板（原右上 hud-tr 已并入左下 hud-bl） */}
      <Hud corner="bl" id="hud-bl">
        <div><span className="k">FPS</span> <span className="v" id="hud-fps">--</span></div>
        <div><span className="k">ENERGY</span> <span className="v" id="hud-energy">0%</span></div>
        <div><span className="k">PEAK</span> <span className="v" id="hud-peak">0%</span></div>
        <div><span className="k">GAIN</span> <span className="v mag">+0.0dB</span></div>
        <ScreenSizeBadge />
      </Hud>

      {/* 对话 / MCP 的开关触发器（原 HUD 上的可见按钮已移除，
          改由底部任务栏承载；这里仅保留隐藏 DOM 钩子供任务栏点击） */}
      <div className="hud-triggers" aria-hidden="true">
        <ChatToggle />
        <McpToggle active={mcpOpen} onClick={() => setMcpOpen((v) => !v)} />
      </div>

      {/* 主对话窗口 */}
      <ChatPanel
        imageOpen={activeTask === "task-image"}
        onToggleImage={() => setActiveTask((t) => (t === "task-image" ? null : "task-image"))}
      />

      {/* MCP 服务器列表浮层（点左下 HUD 的「MCP 服务器」入口开合） */}
      <McpPanel open={mcpOpen} onClose={() => setMcpOpen(false)} />

      {/* 独立配图窗口：生图结果渲染在这里，不再挤进聊天框 */}
      <ImageWindow open={activeTask === "task-image"} onClose={() => setActiveTask(null)} />

      {/* 独立地图窗口：位置标注渲染在这里，不再内联到对话气泡 */}
      <MapErrorBoundary>
        <MapWindow open={mapOpen} onClose={() => setMapOpen(false)} />
      </MapErrorBoundary>

      {/* 独立功能清单窗口：枚举 chat-panel 所有附加功能及其开启状态 */}
      <FeatureListWindow open={featuresOpen} onClose={() => setFeaturesOpen(false)} />

      {/* 独立功能流程图窗口：SVG 渲染各管线数据流，节点可复制源码锚点 */}
      <FlowDiagramWindow open={flowOpen} onClose={() => setFlowOpen(false)} />

      {/* 独立网页查看器：每个网页一个独立浮层（单窗单页，再来一个再弹一个） */}
      {viewers.map((v) => (
        <WebViewerWindow
          key={v.id}
          devId={"web-viewer-" + v.id}
          url={v.url}
          pos={{ x: v.x, y: v.y }}
          open={v.open}
          onClose={() => closeViewer(v.id)}
        />
      ))}

      {/* 设置窗口：语言模型 / 生图模型 / 生图比例 三个切换器迁入此处 */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 油价行情卡片：横向长条，复用主页 HUD 视觉语言，停靠顶部左侧。
          数据经 useOilPrice 从同源 /api/oil 拉取「油价网」真实 92# 零售价：
          - 成功：price/prevClose 为真实全国均价与上一轮调价价，涨跌真实；
          - 失败/首屏：回退占位值，面板不空不崩。
          nextAdjust/prevAdjust 由真实数据提供（上/下轮窗口），倒计时与抓取时间随之刷新。 */}
      <div className="oil-dock">
        <OilPricePanel
          booted={booted}
          data={oil.data}
          forecast={oil.forecast}
          nextAdjust={oil.nextAdjust ? new Date(oil.nextAdjust) : undefined}
          prevAdjust={oil.prevAdjust ? new Date(oil.prevAdjust) : undefined}
          updatedAt={oil.updatedAt}
        />
      </div>

      {/* 底部任务栏：一个按钮 = 一个功能 / 组件入口 */}
      <TaskBar
        active={activeTask}
        onActivate={setActiveTask}
        onToggleMap={() => setMapOpen((v) => !v)}
        mapOpen={mapOpen}
        onToggleFeatures={() => setFeaturesOpen((v) => !v)}
        featuresOpen={featuresOpen}
        onToggleFlow={() => setFlowOpen((v) => !v)}
        flowOpen={flowOpen}
        onToggleWeb={() => {
          const u = window.prompt("打开网址（https://…）");
          if (u && /^https?:\/\//i.test(u.trim())) spawnViewer(u.trim());
        }}
        webOpen={viewers.some((v) => v.open)}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOpen={settingsOpen}
      />

      {/* 调试覆盖层（组件 ID 标注 / 清单 / 复制） */}
      <DevOverlay />

      {/* 启动遮罩（BOOT）：进入主界面后淡出卸载 */}
      {!bootGone && (
        <BootOverlay active={booted} onFinish={() => setBootGone(true)} onSkip={skip} />
      )}
    </>
  );
}
