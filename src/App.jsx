import { useEffect, useState } from "react";
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
import { DevOverlay } from "./components/dev/DevOverlay.jsx";
import { OilPricePanel } from "./components/data/OilPricePanel.jsx";
import { BootOverlay } from "./components/boot/BootOverlay.jsx";
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
  // MCP 浮层默认开启：按需求直接展示服务器列表（不再默认隐藏）。
  const [mcpOpen, setMcpOpen] = useState(true);
  const [activeTask, setActiveTask] = useState(null);
  // 设置窗口开合状态：点击任务栏「设置」打开，窗口内可关闭
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // 清空对话时关闭所有面板（配图窗等）
  useEffect(() => {
    const onCloseAll = () => setActiveTask(null);
    window.addEventListener("jarvis:close-all-panels", onCloseAll);
    return () => window.removeEventListener("jarvis:close-all-panels", onCloseAll);
  }, []);

  // 点击遮罩跳过启动（提前进入主界面）
  const skip = () => {
    if (booted) return;
    document.body.classList.add("booted");
    setBooted(true);
  };

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
        <div><span className="k">SYS</span> <span className="v" id="hud-status">● LIVE</span></div>
        <div><span className="k">FPS</span> <span className="v" id="hud-fps">--</span></div>
        <div><span className="k">MODE</span> <span className="v mag">SIM</span></div>
        <div><span className="k">ENERGY</span> <span className="v" id="hud-energy">0%</span></div>
        <div><span className="k">PEAK</span> <span className="v" id="hud-peak">0%</span></div>
        <div><span className="k">UNIT</span> <span className="v">VX-72</span></div>
        <div><span className="k">BANDS</span> <span className="v" id="hud-bands">72</span></div>
        <div><span className="k">SIG</span> <span className="v mag" id="hud-sig">STREAM</span></div>
        <div><span className="k">FREQ</span> <span className="v" id="hud-freq">20–20k</span></div>
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

      {/* 设置窗口：语言模型 / 生图模型 / 生图比例 三个切换器迁入此处 */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 油价行情卡片：横向长条，复用主页 HUD 视觉语言，停靠底部居中 */}
      <div className="oil-dock">
        <OilPricePanel
          booted={booted}
          data={{ name: "上海 92# 汽油", unit: "¥", price: 7.93, prevClose: 7.38 }}
          nextAdjust={new Date("2026-08-14T24:00:00")}
          forecast={{ direction: "down", text: "预计小幅下调" }}
        />
      </div>

      {/* 底部任务栏：一个按钮 = 一个功能 / 组件入口 */}
      <TaskBar
        active={activeTask}
        onActivate={setActiveTask}
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
