// 可视化形态切换（默认 / 思考 / 输出）。data-form 供 useVizEngine 绑定点击事件。
export function FormSwitchButtons() {
  return (
    <div className="form-switch" id="formSwitch" data-dev-id="fx-form-switch">
      <span className="fs-label">FX</span>
      <button className="form-btn active" data-form="default" type="button">默认</button>
      <button className="form-btn" data-form="thinking" type="button">思考</button>
      <button className="form-btn" data-form="output" type="button">输出</button>
    </div>
  );
}
