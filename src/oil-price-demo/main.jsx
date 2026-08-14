// OilPricePanel 演示入口：上海 92# 汽油（静态真实数据，无实时跳动）。
// 访问：http://localhost:5174/oil-price-demo.html
import React from "react";
import { createRoot } from "react-dom/client";
import "../styles/cyber.css"; // 引入主页视觉语言（token + 背景氛围）
import { OilPricePanel } from "../components/data/OilPricePanel.jsx";

// 数据来源：东方财富 2026-08-01 调价后上海 92# 汽油 = 7.93 元/升（较调价前 +0.55）
// 下次调价窗口：2026-08-14 24:00（来源：国家发改委“十个工作日”原则）
// 预估：金联创/卓创 认为新一轮小幅下调概率较大（机构观点，非承诺）
const oilData = {
  updatedAt: new Date("2026-08-13T22:06:00"),
  name: "上海 92# 汽油",
  sub: "零售指导价 · 元/升",
  unit: "¥",
  price: 7.93,
  prevClose: 7.38, // 8 月 1 日调价前价格
};

const nextAdjust = new Date("2026-08-14T24:00:00");
const forecast = { direction: "down", text: "预计小幅下调" };

function Demo() {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 10,            /* 置于主页背景层（网格/光晕/扫描线）之上 */
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <OilPricePanel
        data={oilData}
        nextAdjust={nextAdjust}
        forecast={forecast}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Demo />);
