/*
 * verify-engine.cjs
 * 引擎逻辑自检：直接 require UMD 引擎（与浏览器打包同一份源码），
 * 推进多帧模拟并断言输出合法，证明重构后唯一的非 UI 逻辑完好。
 * 运行：node scripts/verify-engine.cjs
 */
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

// 工程在 package.json 中声明 "type":"module"，Node 会把 .js 当作 ESM 解析，
// 导致 UMD 的 CommonJS 分支被跳过（module 未定义）。这里用 vm 以 CJS 上下文
// 加载【真实源码文件】，使 module.exports 生效，确保测试的是同一份代码。
const src = fs.readFileSync(path.resolve(__dirname, "../src/lib/spectrum-engine.js"), "utf8");
const sandbox = { module: { exports: {} }, exports: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const Engine = sandbox.module.exports;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("  \u2713 " + name);
  } catch (e) {
    console.error("  \u2717 " + name + " -> " + e.message);
    process.exitCode = 1;
  }
}

console.log("[1] 导出 API 完整");
check("导出包含全部预期函数", () => {
  for (const k of [
    "CONFIG", "clamp", "lerp", "randRange", "neonHueAt", "truncate",
    "createSpectrumState", "simulateSpectrum", "snapshot",
    "isSpectrumQuery", "buildSpectrumReply",
  ]) {
    assert.ok(typeof Engine[k] !== "undefined", "缺少导出: " + k);
  }
});

console.log("[2] 创建状态");
let state;
check("createSpectrumState 返回合法状态", () => {
  state = Engine.createSpectrumState();
  assert.ok(state.config.barCount >= 60, "barCount 异常");
  assert.strictEqual(state.barLevels.length, state.config.barCount);
  assert.strictEqual(state.ringSamples.length, state.config.ringSegments);
  assert.strictEqual(state.elapsed, 0);
});

console.log("[3] 多帧模拟数值稳定（无 NaN / 越界）");
check("1000 帧模拟后数值始终在 [0,1]", () => {
  let dt = 1 / 60;
  for (let i = 0; i < 1000; i++) {
    Engine.simulateSpectrum(state, dt);
    for (let b = 0; b < state.config.barCount; b++) {
      const v = state.barLevels[b];
      assert.ok(Number.isFinite(v), "barLevels 出现非有限值");
      assert.ok(v >= 0 && v <= 1, "barLevels 越界: " + v);
    }
    assert.ok(Number.isFinite(state.energy) && state.energy >= 0 && state.energy <= 1, "energy 异常");
    assert.ok(Number.isFinite(state.peak) && state.peak >= 0 && state.peak <= 1, "peak 异常");
  }
});

console.log("[4] 边界保护：非法 dt 不崩溃");
check("dt 为 NaN / 负 / 超大 时安全", () => {
  Engine.simulateSpectrum(state, NaN);
  Engine.simulateSpectrum(state, -5);
  Engine.simulateSpectrum(state, 9999);
  assert.ok(Number.isFinite(state.energy));
});

console.log("[5] 快照结构正确");
check("snapshot 含频段均值与主导段", () => {
  const snap = Engine.snapshot(state);
  assert.strictEqual(snap.barCount, state.config.barCount);
  assert.ok(typeof snap.lowAvg === "number" && typeof snap.midAvg === "number" && typeof snap.highAvg === "number");
  assert.ok(snap.dominantRatio >= 0 && snap.dominantRatio <= 1);
  assert.ok(Array.isArray(snap.bars) && snap.bars.length === state.config.barCount);
});

console.log("[6] AI 回复逻辑");
check("频谱查询返回数据驱动回答", () => {
  const snap = Engine.snapshot(state);
  const r = Engine.buildSpectrumReply(snap, "当前能量是多少？");
  assert.ok(/实时数据/.test(r), "未返回数据驱动回答: " + r);
});
check("问候语分支", () => {
  const r = Engine.buildSpectrumReply(null, "你好");
  assert.ok(/AI 助手/.test(r));
});
check("普通问题分支（无快照）", () => {
  const r = Engine.buildSpectrumReply(null, "怎么用这个工具？");
  assert.ok(/模拟回复|本地模拟/.test(r));
});
check("isSpectrumQuery 关键词识别", () => {
  assert.strictEqual(Engine.isSpectrumQuery("能量"), true);
  assert.strictEqual(Engine.isSpectrumQuery("今天天气"), false);
});

console.log("[7] 工具函数");
check("clamp / lerp / neonHueAt", () => {
  assert.strictEqual(Engine.clamp(5, 0, 1), 1);
  assert.strictEqual(Engine.clamp(-3, 0, 1), 0);
  assert.strictEqual(Engine.lerp(0, 10, 0.5), 5);
  assert.ok(Engine.neonHueAt(0, 140) >= 180 && Engine.neonHueAt(1, 140) <= 320);
  assert.strictEqual(Engine.truncate("abcdefghij", 5), "abcde…");
});

console.log("\n引擎自检完成：通过 " + passed + " 项断言。");
if (process.exitCode) {
  console.error("存在失败项，请检查引擎。");
} else {
  console.log("全部通过 ✅");
}
