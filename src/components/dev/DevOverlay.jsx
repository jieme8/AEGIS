import { useDevOverlay } from "../../hooks/useDevOverlay.js";

// 调试覆盖层（组件 ID 标注 / 清单 / 复制），仅在编辑模式可见。
export function DevLegend() {
  return (
    <div className="dev-legend" id="devLegend">
      <div className="dev-legend-head" id="devLegendHead">
        <span>组件清单 · MAP</span>
        <span className="cnt" id="devLegendCnt" />
      </div>
      <div className="dev-legend-body" id="devLegendBody" />
    </div>
  );
}

export function DevOverlay() {
  useDevOverlay();
  return (
    <>
      <button className="dev-toggle" id="devToggle" type="button" title="显示 / 隐藏页面组件的参考 ID">
        显示组件ID
      </button>
      <div className="dev-readout" id="devReadout" />
      <div className="dev-toast" id="devToast" />
      <DevLegend />
    </>
  );
}
