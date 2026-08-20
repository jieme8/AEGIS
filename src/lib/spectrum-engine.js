/*
 * spectrum-engine.js
 * 赛博朋克频谱可视化器的共享引擎（UMD）：
 *  - 浏览器中挂载到 window.SpectrumEngine
 *  - Node 中通过 require 导出，供单元测试 / 集成测试直接使用
 * 可视化器与 AI 助手共享同一份模拟与回复逻辑，确保“同一运行环境、实时数据”。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;          // Node / CommonJS（保留，供单元测试 require）
  }
  // 始终挂载到全局，保证浏览器 / 打包环境均可经 window.SpectrumEngine 访问
  if (typeof root !== "undefined" && root) {
    root.SpectrumEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---------- 默认配置 ----------
  const CONFIG = {
    barCount: 72,          // 频谱柱数量（>= 60）
    ringSegments: 160,     // 环形波形采样段数
    ringArms: 6,           // 环形波形臂数
    maxDpr: 2,             // 设备像素比上限
    attack: 0.35,          // 上升（攻击）插值系数
    release: 0.08,         // 下降（释放）插值系数
    peakDecay: 0.55,       // 峰值保持回落速度（每秒）
    rainSpeedMin: 40,      // 数字雨最小下落速度
    rainSpeedMax: 120,     // 数字雨最大下落速度
    glitchChance: 0.012,   // 每帧触发故障的概率
    ringHueSpan: 140,      // 霓虹色相跨度：青(180) → 品红(320)
  };

  // ---------- 纯函数工具 ----------
  const clamp = (value, min, max) =>
    value < min ? min : (value > max ? max : value);
  const lerp = (from, to, ratio) => from + (to - from) * ratio;
  const randRange = (min, max) => min + Math.random() * (max - min);
  const neonHueAt = (ratio, span) => 180 + clamp(ratio, 0, 1) * (span == null ? CONFIG.ringHueSpan : span);
  const truncate = (s, n) => {
    const str = s == null ? "" : String(s);
    return str.length > n ? str.slice(0, n) + "…" : str;
  };

  // ---------- 创建运行状态 ----------
  function createSpectrumState(overrides) {
    const config = Object.assign({}, CONFIG, overrides || {});
    return {
      config,
      elapsed: 0,            // 累计模拟时间（秒）
      glitchCountdown: 0,    // 故障效果剩余持续时间（秒）
      energy: 0,             // 整体能量 0..1
      peak: 0,               // 全局峰值 0..1
      barLevels: new Float32Array(config.barCount),
      barPeaks: new Float32Array(config.barCount),
      ringSamples: new Float32Array(config.ringSegments),
    };
  }

  // ---------- 推进一帧模拟 ----------
  // dt 已做边界保护：非有限值按 0 处理，并限制在 [0, 0.05]，防止跳变或 NaN 传播
  function simulateSpectrum(state, dtRaw) {
    const cfg = state.config;
    const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.05);
    if (dt <= 0) return;   // 无时间推进则跳过，避免无意义计算与副作用

    state.elapsed += dt;

    let levelSum = 0;
    let maxPeak = 0;

    for (let i = 0; i < cfg.barCount; i++) {
      const ratio = i / cfg.barCount;
      let sample = 0;
      sample += Math.sin(state.elapsed * 1.7 + i * 0.35) * 0.25;
      sample += Math.sin(state.elapsed * 2.9 + i * 0.12 + 1.3) * 0.20;
      sample += Math.sin(state.elapsed * 0.7 + i * 0.05) * 0.15;

      const lowBoost = 1 - ratio * 0.55;            // 低频（左）权重更高
      sample = (sample * 0.5 + 0.5) * lowBoost;
      sample += (Math.random() - 0.5) * 0.12 * (0.4 + lowBoost); // 随机噪声
      sample = clamp(sample, 0, 1);

      // 攻击快、释放慢，过渡更自然
      const factor = sample > state.barLevels[i] ? cfg.attack : cfg.release;
      state.barLevels[i] = lerp(state.barLevels[i], sample, factor);

      // 峰值保持：创新高时记录，否则按时间回落
      if (state.barLevels[i] > state.barPeaks[i]) {
        state.barPeaks[i] = state.barLevels[i];
      } else {
        state.barPeaks[i] = Math.max(state.barLevels[i], state.barPeaks[i] - dt * cfg.peakDecay);
      }

      levelSum += state.barLevels[i];
      if (state.barPeaks[i] > maxPeak) maxPeak = state.barPeaks[i];
    }

    // 环形波形：随角度与时间的多臂正弦
    for (let j = 0; j < cfg.ringSegments; j++) {
      const angle = (j / cfg.ringSegments) * Math.PI * 2;
      let w = Math.sin(angle * cfg.ringArms + state.elapsed * 3.0) * 0.60
            + Math.sin(angle * 2 - state.elapsed * 1.5) * 0.25
            + Math.sin(state.elapsed * 4.0 + angle * 5.0) * 0.15;
      w = w * 0.5 + 0.5;
      state.ringSamples[j] = lerp(state.ringSamples[j], w, 0.2);
    }

    state.energy = clamp(levelSum / cfg.barCount, 0, 1);
    state.peak = clamp(maxPeak, 0, 1);
  }

  // ---------- 实时快照（供 AI 助手读取） ----------
  function snapshot(state) {
    const cfg = state.config;
    const bars = Array.from(state.barLevels);
    const third = Math.max(1, Math.floor(cfg.barCount / 3));
    const avg = (from, to) => {
      let s = 0;
      for (let i = from; i < to; i++) s += bars[i];
      return s / (to - from);
    };
    let dominant = 0;
    for (let i = 1; i < bars.length; i++) {
      if (bars[i] > bars[dominant]) dominant = i;
    }
    return {
      energy: state.energy,
      peak: state.peak,
      barCount: cfg.barCount,
      ringSegments: cfg.ringSegments,
      bars,
      lowAvg: avg(0, third),
      midAvg: avg(third, third * 2),
      highAvg: avg(third * 2, bars.length),
      dominantRatio: cfg.barCount > 0 ? dominant / cfg.barCount : 0,
    };
  }

  // ---------- AI 回复（可感知实时频谱数据） ----------
  function isSpectrumQuery(text) {
    return /频谱|能量|数据|电平|频段|频率|波形|峰值|当前|实时|energy|spectrum|level|data/i.test(text || "");
  }

  function buildSpectrumReply(snap, text) {
    const t = (text || "").trim();
    if (/^(你好|您好|hi|hello|嗨|在吗|在么)/i.test(t)) {
      return "你好，我是集成在频谱可视化器中的 AI 助手。我能读取实时频谱数据——试试问我“当前能量是多少？”";
    }
    if (/谢谢|感谢|多谢/i.test(t)) return "不客气。";

    // 仅当存在实时快照且用户询问频谱相关时才返回数据驱动的回答
    if (snap && isSpectrumQuery(t)) {
      const pct = (v) => Math.round(v * 100);
      const band = snap.dominantRatio < 0.34 ? "低频" : (snap.dominantRatio < 0.67 ? "中频" : "高频");
      return `实时数据 · 共 ${snap.barCount} 个频段：\n` +
             `· 整体能量 ${pct(snap.energy)}%（峰值 ${pct(snap.peak)}%）\n` +
             `· 低/中/高频均值 ${pct(snap.lowAvg)}% / ${pct(snap.midAvg)}% / ${pct(snap.highAvg)}%\n` +
             `· 当前能量主要集中在${band}段。`;
    }

    if (t.endsWith("?") || t.endsWith("？") || /怎么|如何|为什么|是什么/i.test(t)) {
      return `关于“${truncate(t, 24)}”，这是本地模拟回答。我也能读取实时频谱——你可以问我当前能量、频段分布等。`;
    }
    const pool = [
      `收到：“${truncate(t, 24)}”。当前为模拟回复；需要实时频谱数据的话，直接问我即可。`,
      `明白，你提到“${truncate(t, 24)}”。若接入真实大模型 API，这里会是更贴合的回应。`,
      `关于“${truncate(t, 24)}”，我理解你的意思。需要我进一步说明吗？`,
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return {
    CONFIG, clamp, lerp, randRange, neonHueAt, truncate,
    createSpectrumState, simulateSpectrum, snapshot,
    isSpectrumQuery, buildSpectrumReply,
  };
});
