// 频谱可视化画布宿主（#stage > #viz），承载 useVizEngine 的渲染逻辑。
export function SpectrumCanvas() {
  return (
    <div id="stage" data-dev-id="fx-spectrum">
      <canvas id="viz" />
    </div>
  );
}
