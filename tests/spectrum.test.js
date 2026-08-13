/*
 * 频谱引擎 + 集成测试的自动化套件（Node: node --test）
 * 覆盖：纯函数单元、模拟推进、快照、AI 实时数据回复、边界条件、
 *      以及页面的 DOM 冒烟校验（元素引用 / 脚本可解析 / 共享引擎接入）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ENGINE = require("../spectrum-engine.js");
const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "audio-visualizer.html");
const ENGINE_PATH = path.join(ROOT, "spectrum-engine.js");

// ===================== 单元测试：纯函数 =====================
test("clamp 边界与区间", () => {
  assert.strictEqual(ENGINE.clamp(5, 0, 1), 1);
  assert.strictEqual(ENGINE.clamp(-1, 0, 1), 0);
  assert.strictEqual(ENGINE.clamp(0.5, 0, 1), 0.5);
  assert.strictEqual(ENGINE.clamp(0, 0, 1), 0);
  assert.strictEqual(ENGINE.clamp(1, 0, 1), 1);
});

test("lerp 线性插值", () => {
  assert.strictEqual(ENGINE.lerp(0, 10, 0.5), 5);
  assert.strictEqual(ENGINE.lerp(2, 2, 0.9), 2);
  assert.strictEqual(ENGINE.lerp(0, 100, 0), 0);
  assert.strictEqual(ENGINE.lerp(0, 100, 1), 100);
});

test("randRange 落在 [min,max) 且多次取样覆盖区间", () => {
  for (let i = 0; i < 200; i++) {
    const v = ENGINE.randRange(40, 120);
    assert.ok(v >= 40 && v < 120, `randRange 越界: ${v}`);
  }
});

test("neonHueAt 仅在 [180,320] 且对越界比例做 clamp", () => {
  assert.strictEqual(ENGINE.neonHueAt(0), 180);
  assert.strictEqual(ENGINE.neonHueAt(1), 320);
  assert.strictEqual(ENGINE.neonHueAt(0.5), 250);
  assert.strictEqual(ENGINE.neonHueAt(-5), 180);   // 低于下限被夹到 180
  assert.strictEqual(ENGINE.neonHueAt(5), 320);    // 高于上限被夹到 320
});

test("truncate 超长截断、短字符串不变、空值安全", () => {
  assert.strictEqual(ENGINE.truncate("abcdefghijklmnopqrstuvwxyz", 5), "abcde…");
  assert.strictEqual(ENGINE.truncate("short", 5), "short");
  assert.strictEqual(ENGINE.truncate(null, 5), "");
  assert.strictEqual(ENGINE.truncate(undefined, 5), "");
});

// ===================== 单元测试：状态创建 =====================
test("createSpectrumState 初始化结构正确", () => {
  const s = ENGINE.createSpectrumState();
  assert.strictEqual(s.barLevels.length, ENGINE.CONFIG.barCount);
  assert.strictEqual(s.barPeaks.length, ENGINE.CONFIG.barCount);
  assert.strictEqual(s.ringSamples.length, ENGINE.CONFIG.ringSegments);
  assert.strictEqual(s.energy, 0);
  assert.strictEqual(s.peak, 0);
  assert.ok(Array.isArray(s.config.barCount ? [] : [])); // config 存在
});

test("createSpectrumState 支持配置覆盖（合并）", () => {
  const s = ENGINE.createSpectrumState({ barCount: 32 });
  assert.strictEqual(s.barLevels.length, 32);
  assert.strictEqual(s.config.barCount, 32);
  assert.strictEqual(s.config.attack, ENGINE.CONFIG.attack); // 其余保留默认
});

// ===================== 单元测试：模拟推进 =====================
test("simulateSpectrum 单步后数值合法且含能量/峰值", () => {
  const s = ENGINE.createSpectrumState();
  ENGINE.simulateSpectrum(s, 0.016);
  for (let i = 0; i < s.barLevels.length; i++) {
    assert.ok(Number.isFinite(s.barLevels[i]), "barLevels 出现非有限值");
    assert.ok(s.barLevels[i] >= 0 && s.barLevels[i] <= 1, "barLevels 越界");
  }
  assert.ok(s.energy >= 0 && s.energy <= 1, "energy 越界");
  assert.ok(s.peak >= 0 && s.peak <= 1, "peak 越界");
  assert.ok(s.peak >= s.energy - 1e-9, "peak 应不小于 energy");
});

test("simulateSpectrum 多步后数值始终有限且落在 [0,1]", () => {
  const s = ENGINE.createSpectrumState();
  for (let i = 0; i < 1000; i++) {
    ENGINE.simulateSpectrum(s, Math.random() * 0.05);
  }
  for (let i = 0; i < s.barLevels.length; i++) {
    assert.ok(Number.isFinite(s.barLevels[i]));
    assert.ok(s.barLevels[i] >= 0 && s.barLevels[i] <= 1);
  }
  assert.ok(Number.isFinite(s.energy) && Number.isFinite(s.peak));
});

// ===================== 边界条件测试 =====================
test("边界：dt = 0 不产生 NaN 且 elapsed 不前进", () => {
  const s = ENGINE.createSpectrumState();
  ENGINE.simulateSpectrum(s, 0);
  assert.strictEqual(s.elapsed, 0);
  assert.ok(s.barLevels.every((v) => v === 0));
  assert.ok(Number.isFinite(s.energy));
});

test("边界：dt 为负被当作 0（clamp 下限）", () => {
  const s = ENGINE.createSpectrumState();
  ENGINE.simulateSpectrum(s, -10);
  assert.strictEqual(s.elapsed, 0);
  assert.ok(s.barLevels.every((v) => v === 0));
  assert.ok(!Number.isNaN(s.energy));
});

test("边界：dt 极大被限制为 0.05，数值仍合法", () => {
  const s = ENGINE.createSpectrumState();
  ENGINE.simulateSpectrum(s, 1e9);
  assert.ok(s.elapsed <= 0.05 + 1e-9);
  assert.ok(s.barLevels.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
});

test("边界：dt 为非有限值（NaN/Infinity）不产生 NaN", () => {
  const s1 = ENGINE.createSpectrumState();
  ENGINE.simulateSpectrum(s1, NaN);
  assert.ok(s1.barLevels.every((v) => !Number.isNaN(v)));
  const s2 = ENGINE.createSpectrumState();
  ENGINE.simulateSpectrum(s2, Infinity);
  assert.ok(s2.barLevels.every((v) => !Number.isNaN(v) && v >= 0 && v <= 1));
});

test("边界：长时间运行峰值不会出现负值或溢出", () => {
  const s = ENGINE.createSpectrumState();
  for (let i = 0; i < 5000; i++) ENGINE.simulateSpectrum(s, 0.05);
  assert.ok(s.peak >= 0 && s.peak <= 1);
  assert.ok(s.energy >= 0 && s.energy <= 1);
});

// ===================== 快照测试 =====================
test("snapshot 结构完整且派生指标在 [0,1]", () => {
  const s = ENGINE.createSpectrumState();
  for (let i = 0; i < 60; i++) ENGINE.simulateSpectrum(s, 0.016);
  const snap = ENGINE.snapshot(s);
  assert.strictEqual(snap.bars.length, s.barLevels.length);
  assert.ok(snap.energy >= 0 && snap.energy <= 1);
  assert.ok(snap.lowAvg >= 0 && snap.lowAvg <= 1);
  assert.ok(snap.midAvg >= 0 && snap.midAvg <= 1);
  assert.ok(snap.highAvg >= 0 && snap.highAvg <= 1);
  assert.ok(snap.dominantRatio >= 0 && snap.dominantRatio <= 1);
  // energy 应约等于 bars 均值
  const mean = snap.bars.reduce((a, b) => a + b, 0) / snap.bars.length;
  assert.ok(Math.abs(mean - snap.energy) < 1e-6);
});

// ===================== AI 回复单元测试 =====================
test("buildSpectrumReply 问候语返回字符串", () => {
  const r = ENGINE.buildSpectrumReply(null, "你好");
  assert.ok(typeof r === "string" && r.length > 0);
});

test("buildSpectrumReply 致谢返回字符串", () => {
  const r = ENGINE.buildSpectrumReply(null, "谢谢");
  assert.ok(typeof r === "string" && r.length > 0);
});

test("buildSpectrumReply 空/未定义文本不抛错", () => {
  assert.ok(typeof ENGINE.buildSpectrumReply(null, "") === "string");
  assert.ok(typeof ENGINE.buildSpectrumReply(null, undefined) === "string");
});

test("buildSpectrumReply 频谱提问（无快照）安全返回字符串", () => {
  const r = ENGINE.buildSpectrumReply(null, "当前能量多少？");
  assert.ok(typeof r === "string" && r.length > 0);
});

test("buildSpectrumReply 频谱提问（有快照）返回含能量的数据行", () => {
  const s = ENGINE.createSpectrumState();
  for (let i = 0; i < 120; i++) ENGINE.simulateSpectrum(s, 0.016);
  const snap = ENGINE.snapshot(s);
  const r = ENGINE.buildSpectrumReply(snap, "当前能量多少？");
  assert.ok(/能量/.test(r), "应提及能量");
  assert.ok(/%/.test(r), "应给出百分比");
  assert.ok(/频段/.test(r), "应给出频段信息");
});

test("buildSpectrumReply 普通问题返回字符串", () => {
  const r = ENGINE.buildSpectrumReply(null, "你怎么看这件事？");
  assert.ok(typeof r === "string" && r.length > 0);
});

test("isSpectrumQuery 关键词识别", () => {
  assert.ok(ENGINE.isSpectrumQuery("当前能量"));
  assert.ok(ENGINE.isSpectrumQuery("spectrum"));
  assert.ok(!ENGINE.isSpectrumQuery("你好呀"));
});

// ===================== 集成测试：可视化 ↔ AI 共享数据 =====================
test("集成：可视化推进后，AI 能读到同一份实时数据作答", () => {
  // 模拟页面：可视化器与 AI 共享同一个 state（通过 snapshot）
  const shared = ENGINE.createSpectrumState();
  const SpectrumAPI = { snapshot: () => ENGINE.snapshot(shared) };

  for (let i = 0; i < 200; i++) ENGINE.simulateSpectrum(shared, 0.016);

  const snap = SpectrumAPI.snapshot();
  assert.ok(snap.energy > 0, "运行一段时间后能量应大于 0");

  const reply = ENGINE.buildSpectrumReply(snap, "实时频谱怎么样？");
  assert.ok(/能量\s*\d+%/.test(reply), "AI 回答应包含实时能量百分比");

  // 改变数据后，AI 回答应反映新值（数据确实被实时读取）
  for (let i = 0; i < 50; i++) ENGINE.simulateSpectrum(shared, 0.05);
  const snap2 = SpectrumAPI.snapshot();
  const reply2 = ENGINE.buildSpectrumReply(snap2, "现在能量多少？");
  const m = reply2.match(/能量\s*(\d+)%/);
  assert.ok(m, "应能解析能量百分比");
  assert.strictEqual(Number(m[1]), Math.round(snap2.energy * 100));
});

test("集成：窗口全局与 Node 导出一致（同一份实现）", () => {
  // 引擎在 Node 下通过 module.exports 暴露，浏览器下通过 window.SpectrumEngine
  // 此处验证导出集合完整
  for (const key of ["CONFIG", "clamp", "lerp", "randRange", "neonHueAt",
                     "truncate", "createSpectrumState", "simulateSpectrum",
                     "snapshot", "isSpectrumQuery", "buildSpectrumReply"]) {
    assert.ok(typeof ENGINE[key] !== "undefined", `缺少导出: ${key}`);
  }
});

// ===================== 页面 DOM 冒烟测试 =====================
test("页面冒烟：spectrum-engine.js 存在且无语法错误", () => {
  assert.ok(fs.existsSync(ENGINE_PATH), "引擎文件缺失");
  const code = fs.readFileSync(ENGINE_PATH, "utf8");
  assert.doesNotThrow(() => new Function(code), "引擎语法错误");
});

test("页面冒烟：HTML 引用了共享引擎脚本", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  assert.ok(/<script src="spectrum-engine\.js"><\/script>/.test(html),
    "HTML 未引入 spectrum-engine.js");
});

test("页面冒烟：所有 getElementById 引用的 id 均在页面中定义", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const referenced = new Set();
  const reRef = /getElementById\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = reRef.exec(html)) !== null) referenced.add(m[1]);

  const defined = new Set();
  const reDef = /\bid="([^"]+)"/g;
  while ((m = reDef.exec(html)) !== null) defined.add(m[1]);

  for (const id of referenced) {
    assert.ok(defined.has(id), `引用的元素 id 未在页面定义: #${id}`);
  }
});

test("页面冒烟：两段内联脚本均可解析，且引用 SpectrumEngine/SpectrumAPI", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const reScript = /<script>([\s\S]*?)<\/script>/g;
  let m, blocks = 0;
  while ((m = reScript.exec(html)) !== null) {
    blocks++;
    assert.doesNotThrow(() => new Function(m[1]), "内联脚本语法错误");
  }
  assert.ok(blocks >= 2, "应至少包含可视化器与聊天两段内联脚本");
  assert.ok(/SpectrumEngine/.test(html), "页面应引用 SpectrumEngine");
  assert.ok(/SpectrumAPI/.test(html), "页面应引用 SpectrumAPI（实时数据桥）");
});
