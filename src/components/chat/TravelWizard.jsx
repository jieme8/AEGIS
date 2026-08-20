import { useState } from "react";

// 周末出行规划 · 引导式点选向导（替代自由文本填参）
// 四步：LOCATION → PREFERENCE → CONFIG → DATE，全部点选，完成后组装结构化指令发给 AI。

const LOCATION_GROUPS = [
  { group: "杭州", items: ["西湖区", "灵隐", "良渚文化村"] },
  { group: "深圳", items: ["南山区", "福田区", "盐田区"] },
  { group: "上海", items: ["徐汇区", "浦东新区", "黄浦区"] },
  { group: "成都", items: ["锦江区", "武侯区", "青羊区"] },
  { group: "北京", items: ["朝阳区", "海淀区", "东城区"] },
  { group: "南京", items: ["玄武区", "秦淮区", "建邺区"] },
  { group: "重庆", items: ["渝中区", "南岸区", "江北区"] },
  { group: "厦门", items: ["思明区", "鼓浪屿", "集美区"] },
  { group: "西安", items: ["雁塔区", "碑林区", "曲江新区"] },
];

const PREFERENCES = ["自然徒步", "城市Citywalk", "展演艺", "美食市集", "室内娱乐", "其他"];
const ATTRS = ["单人", "情侣", "家庭", "宠物友好"];
const BUDGETS = ["不限", "200元内", "200-500元", "500-1000元", "1000元以上"];

function fmtDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return { iso: `${d.getFullYear()}-${m}-${day}`, label: `${m}/${day} ${wd}` };
}

function getDateOptions() {
  const now = new Date();
  const thisSat = new Date(now);
  thisSat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
  const thisSun = new Date(thisSat);
  thisSun.setDate(thisSat.getDate() + 1);
  const nextSat = new Date(thisSat);
  nextSat.setDate(thisSat.getDate() + 7);
  const nextSun = new Date(nextSat);
  nextSun.setDate(nextSat.getDate() + 1);
  return [
    { key: "this-sat", label: "本周六 " + fmtDate(thisSat).label, ...fmtDate(thisSat) },
    { key: "this-sun", label: "本周日 " + fmtDate(thisSun).label, ...fmtDate(thisSun) },
    { key: "next-sat", label: "下周六 " + fmtDate(nextSat).label, ...fmtDate(nextSat) },
    { key: "next-sun", label: "下周日 " + fmtDate(nextSun).label, ...fmtDate(nextSun) },
  ];
}

const DATE_OPTIONS = getDateOptions();

function buildPrompt({ loc, pref, attrs, budget, date }) {
  const attrsText = attrs.length ? attrs.join("、") : "未指定";
  const budgetText = budget || "不限";
  const dateText = date ? `${date.iso}（${date.label}）` : "未指定";
  return [
    "请为我制定周末出行方案。",
    "",
    "【出行参数】",
    `- 城市/区域：${loc || "未指定"}`,
    `- 偏好类型：${pref || "未指定"}`,
    `- 出行属性：${attrsText}；预算区间：${budgetText}`,
    `- 日期：${dateText}`,
    "",
    "请基于事实准确性准则，输出包含以下四部分的方案，所有节点（活动页、门票、交通、天气）必须附可溯源 URL，无法核实的请标注「（来源未确认）」：",
    "① 精选路线（含点位顺序与大致时长）",
    "② 官方活动页 / 门票购买链接",
    "③ 公共交通 / 停车方案",
    "④ 天气预警与出行建议",
    "如涉及实时数据（活动排期、天气、交通管制），请明确声明时效边界，并建议以官方渠道为准。",
  ].join("\n");
}

export function TravelWizard({ open, onClose, send }) {
  const [step, setStep] = useState(0);
  const [loc, setLoc] = useState(null);
  const [pref, setPref] = useState(null);
  const [attrs, setAttrs] = useState([]);
  const [budget, setBudget] = useState(null);
  const [date, setDate] = useState(null);

  if (!open) return null;

  const reset = () => {
    setStep(0);
    setLoc(null); setPref(null); setAttrs([]); setBudget(null); setDate(null);
  };
  const close = () => { reset(); onClose(); };

  const toggleAttr = (a) =>
    setAttrs((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const canNext = [!!loc, !!pref, true, !!date][step]; // CONFIG 步可跳过（属性/预算非必填）

  const steps = [
    {
      title: "目标城市 / 区域",
      hint: "点选一个区域，或选「其他城市」后在聊天里补充。",
      render: (
        <div className="tw-loc-grid">
          {LOCATION_GROUPS.map((g) => (
            <div className="tw-loc-group" key={g.group}>
              <div className="tw-loc-group-name">{g.group}</div>
              <div className="tw-chips">
                {g.items.map((it) => {
                  const v = g.group + "·" + it;
                  return (
                    <button
                      type="button"
                      key={v}
                      className={"tw-chip" + (loc === v ? " on" : "")}
                      onClick={() => setLoc(v)}
                    >{it}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            type="button"
            className={"tw-chip tw-chip-wide" + (loc === "其他城市（聊天补充）" ? " on" : "")}
            onClick={() => setLoc("其他城市（聊天补充）")}
          >其他城市（聊天补充）</button>
        </div>
      ),
    },
    {
      title: "偏好类型",
      hint: "单选。",
      render: (
        <div className="tw-chips tw-chips-center">
          {PREFERENCES.map((p) => (
            <button
              type="button"
              key={p}
              className={"tw-chip" + (pref === p ? " on" : "")}
              onClick={() => setPref(p)}
            >{p}</button>
          ))}
        </div>
      ),
    },
    {
      title: "出行属性 / 预算",
      hint: "属性可多选；预算单选（可跳过）。",
      render: (
        <div className="tw-block">
          <div className="tw-sub">出行属性</div>
          <div className="tw-chips tw-chips-center">
            {ATTRS.map((a) => (
              <button
                type="button"
                key={a}
                className={"tw-chip" + (attrs.includes(a) ? " on" : "")}
                onClick={() => toggleAttr(a)}
              >{a}</button>
            ))}
          </div>
          <div className="tw-sub">预算区间</div>
          <div className="tw-chips tw-chips-center">
            {BUDGETS.map((b) => (
              <button
                type="button"
                key={b}
                className={"tw-chip" + (budget === b ? " on" : "")}
                onClick={() => setBudget(b)}
              >{b}</button>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: "出行日期",
      hint: "单选一个周末日期。",
      render: (
        <div className="tw-chips tw-chips-center">
          {DATE_OPTIONS.map((d) => (
            <button
              type="button"
              key={d.key}
              className={"tw-chip" + (date && date.key === d.key ? " on" : "")}
              onClick={() => setDate(d)}
            >{d.label}</button>
          ))}
        </div>
      ),
    },
  ];

  const submit = () => {
    const prompt = buildPrompt({ loc, pref, attrs, budget, date });
    console.log("[travel-wizard] 生成方案", { loc, pref, attrs, budget, date, sendType: typeof send, promptLength: prompt.length });
    if (typeof send === "function") {
      send(prompt).catch((e) => console.error("[travel-wizard] 发送失败", e));
    } else {
      console.error("[travel-wizard] send 不是函数，无法发送", send);
    }
    close();
  };

  const current = steps[step];

  return (
    <div className="tw-overlay" role="dialog" aria-modal="true" aria-label="周末出行规划向导">
      <div className="tw-card">
        <div className="tw-head">
          <span className="tw-title">🧭 周末出行规划</span>
          <button type="button" className="tw-x" aria-label="关闭" onClick={close}>×</button>
        </div>

        <div className="tw-steps">
          {steps.map((s, i) => (
            <div key={i} className={"tw-step-dot" + (i === step ? " active" : "") + (i < step ? " done" : "")}>
              <span className="tw-step-num">{i + 1}</span>
              <span className="tw-step-name">{["城市", "偏好", "属性", "日期"][i]}</span>
            </div>
          ))}
        </div>

        <div className="tw-body">
          <div className="tw-q">{current.title}</div>
          <div className="tw-hint">{current.hint}</div>
          {current.render}
        </div>

        <div className="tw-foot">
          <button type="button" className="tw-btn ghost" onClick={() => (step === 0 ? close() : setStep((s) => s - 1))}>
            {step === 0 ? "取消" : "上一步"}
          </button>
          {step < steps.length - 1 ? (
            <button type="button" className="tw-btn" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              下一步
            </button>
          ) : (
            <button type="button" className="tw-btn primary" disabled={!loc || !pref || !date} onClick={submit}>
              生成方案 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
