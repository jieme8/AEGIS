// 顶部故障标题（J.A.R.V.I.S. + 副标题全称），glitch 效果由 CSS 驱动。
export function TitleBar() {
  return (
    <div className="title-wrap" data-dev-id="fx-title">
      <div className="glitch" data-text="J.A.R.V.I.S.">J.A.R.V.I.S.</div>
      <div className="sub-title">Just A Rather Very Intelligent System</div>
    </div>
  );
}
