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

export default function App() {
  // 启动可视化引擎（canvas 渲染 / 形态切换 / 黑客流拖拽），挂载于根组件，仅初始化一次。
  useVizEngine();

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
      <Hud corner="tl" id="hud-tl">
        <div><span className="k">SYS</span> <span className="v" id="hud-status">● LIVE</span></div>
        <div><span className="k">FPS</span> <span className="v" id="hud-fps">--</span></div>
        <div><span className="k">MODE</span> <span className="v mag">SIM</span></div>
      </Hud>
      <Hud corner="tr" id="hud-tr">
        <div><span className="k">UNIT</span> <span className="v">VX-72</span></div>
        <div><span className="k">BANDS</span> <span className="v" id="hud-bands">72</span></div>
        <div><span className="k">SIG</span> <span className="v mag" id="hud-sig">STREAM</span></div>
        <ChatToggle />
      </Hud>
      <Hud corner="bl" id="hud-bl">
        <div><span className="k">ENERGY</span> <span className="v" id="hud-energy">0%</span></div>
        <div><span className="k">PEAK</span> <span className="v" id="hud-peak">0%</span></div>
      </Hud>
      <Hud corner="br" id="hud-br">
        <div><span className="k">FREQ</span> <span className="v" id="hud-freq">20–20k</span></div>
        <div><span className="k">GAIN</span> <span className="v mag">+0.0dB</span></div>
      </Hud>

      {/* 主对话窗口 */}
      <ChatPanel />

      {/* 调试覆盖层（组件 ID 标注 / 清单 / 复制） */}
      <DevOverlay />
    </>
  );
}
