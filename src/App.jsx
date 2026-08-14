import { useEffect, useState } from "react";
import { useVizEngine } from "./hooks/useVizEngine.js";
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
import { HackerStreamZone } from "./components/viz/HackerStreamZone.jsx";
import { RingHotZone, BarsHotZone } from "./components/viz/DevZones.jsx";
import { Hud, ChatToggle } from "./components/hud/Hud.jsx";
import { ChatPanel } from "./components/chat/ChatPanel.jsx";
import { DevOverlay } from "./components/dev/DevOverlay.jsx";
import { OilPricePanel } from "./components/data/OilPricePanel.jsx";
import { BootOverlay } from "./components/boot/BootOverlay.jsx";
import { BOOT_MS, SEQUENCE } from "./lib/bootTimeline.js";

// 入场时序 el → 真实 DOM 选择器（与 bootTimeline.SEQUENCE 一一对应）
const SEQ_SELECTOR = {
  title: ".title-wrap",
  "hud-tr": ".hud.tr",
  stage: "#stage",
  "form-switch": ".form-switch",
  hacker: ".hacker-drag-zone",
  "hud-bl": ".hud.bl",
  "hud-br": ".hud.br",
  oil: ".oil-dock",
  chat: ".chat-panel",
};

export default function App() {
  // 启动可视化引擎（canvas 渲染 / 形态切换 / 黑客流拖拽），挂载于根组件，仅初始化一次。
  useVizEngine();

  // 启动序列状态：booted=进入主界面（body.booted 触发组件错落入场）；
  // bootGone=遮罩已退场可卸载。
  const [booted, setBooted] = useState(false);
  const [bootGone, setBootGone] = useState(false);

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

      {/* 四角 HUD 面板 */}
      <Hud corner="tr" id="hud-tr">
        <div><span className="k">UNIT</span> <span className="v">VX-72</span></div>
        <div><span className="k">BANDS</span> <span className="v" id="hud-bands">72</span></div>
        <div><span className="k">SIG</span> <span className="v mag" id="hud-sig">STREAM</span></div>
        <ChatToggle />
      </Hud>
      <Hud corner="bl" id="hud-bl">
        <div><span className="k">SYS</span> <span className="v" id="hud-status">● LIVE</span></div>
        <div><span className="k">FPS</span> <span className="v" id="hud-fps">--</span></div>
        <div><span className="k">MODE</span> <span className="v mag">SIM</span></div>
        <div><span className="k">ENERGY</span> <span className="v" id="hud-energy">0%</span></div>
        <div><span className="k">PEAK</span> <span className="v" id="hud-peak">0%</span></div>
      </Hud>
      <Hud corner="br" id="hud-br">
        <div><span className="k">FREQ</span> <span className="v" id="hud-freq">20–20k</span></div>
        <div><span className="k">GAIN</span> <span className="v mag">+0.0dB</span></div>
      </Hud>

      {/* 主对话窗口 */}
      <ChatPanel />

      {/* 油价行情卡片：横向长条，复用主页 HUD 视觉语言，停靠底部居中 */}
      <div className="oil-dock">
        <OilPricePanel
          booted={booted}
          data={{ name: "上海 92# 汽油", unit: "¥", price: 7.93, prevClose: 7.38 }}
          nextAdjust={new Date("2026-08-14T24:00:00")}
          forecast={{ direction: "down", text: "预计小幅下调" }}
        />
      </div>

      {/* 调试覆盖层（组件 ID 标注 / 清单 / 复制） */}
      <DevOverlay />

      {/* 启动遮罩（BOOT）：进入主界面后淡出卸载 */}
      {!bootGone && (
        <BootOverlay active={booted} onFinish={() => setBootGone(true)} onSkip={skip} />
      )}
    </>
  );
}
