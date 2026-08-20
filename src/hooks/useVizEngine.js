import { useEffect } from "react";

/**
 * 赛博朋克音频频谱可视化器 —— 工程化重构版（React 化）
 * 逻辑与原 viz 脚本 1:1 移植：72 条霓虹频谱柱 + 中央环形波形，
 * 由共享引擎模拟数据驱动；形态（默认/思考/输出）形变过渡。
 * 通过 window.CyberFx / window.SpectrumAPI 与聊天、调试模块共享同一运行环境。
 */
export function useVizEngine() {
  useEffect(() => {
    "use strict";

    const CONFIG = window.SpectrumEngine.CONFIG;

    // ---------- DOM 引用 ----------
    const canvas = document.getElementById("viz");
    const ctx = canvas ? canvas.getContext("2d") : null;
    const hudNodes = {
      status: document.getElementById("hud-status"),
      fps: document.getElementById("hud-fps"),
      energy: document.getElementById("hud-energy"),
      peak: document.getElementById("hud-peak"),
    };

    // 浏览器不支持 Canvas 2D 时优雅降级，避免后续空引用崩溃
    if (!ctx) {
      console.error("[SPECTRUM] 当前环境不支持 Canvas 2D 渲染，已停止初始化。");
      return;
    }

    const FONT_STACK = '"JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Code", "Consolas", ' +
      '"Roboto Mono", Menlo, monospace';

    // ---------- 复用共享引擎（spectrum-engine.js） ----------
    const { clamp, lerp, randRange } = window.SpectrumEngine;

    // ---------- 运行时状态（由引擎创建，可视化与 AI 共享同一份数据） ----------
    const spectrumState = window.SpectrumEngine.createSpectrumState();
    const barLevels = spectrumState.barLevels;
    const barPeaks = spectrumState.barPeaks;
    const ringSamples = spectrumState.ringSamples;
    let dataRain = [];

    // 视口尺寸（CSS 像素），由 resizeCanvas 维护
    let viewWidth = 0;
    let viewHeight = 0;
    // 当前生效的设备像素比（resizeCanvas 内更新），用于 canvas 文字“设备像素网格吸附”
    let renderDpr = 1;

    // 时间戳（用于推算帧间隔 dt）
    let lastTimestamp = 0;

    // 启动入场（从无到有）：booted 后按分层时序让各图层“生成”——
    // 数据雨/黑客流淡入，fx-bars 自基线逐根生长（左→右扫描），fx-ring 自圆心绽放 +
    // 顺时针“描边成形”，故障层最后浮现。详见 render() 里的 bootT 分段。
    const BOOT_REVEAL = 1900;        // 入场总时长（ms）
    let bootRampStart = 0;           // booted 后计时起点

    // 向 AI 助手暴露实时频谱快照，实现“共享运行环境、实时响应数据”
    window.SpectrumAPI = {
      snapshot: () => window.SpectrumEngine.snapshot(spectrumState),
    };

    // ---------- 可视化形态（默认 / 思考 / 输出），由按钮或对话交互切换 ----------
    const fxState = { t: 0 };                        // 仅时间累加器
    let vizForm = "default";                         // 目标形态 default | thinking | output
    let vizFormFrom = "default";                     // 过渡起始形态
    let formMix = 1;                                 // 过渡进度 0→1（1=完全到达目标）
    let formTimer = 0;
    let formFlash = 0;                               // 切换瞬间爆闪/脉冲，强化状态变更感知
    const FORM_DUR = 1.05;                           // 形态切换（形变）时长（秒）——延长以更可感知

    // 缓动曲线：带轻微过冲的回弹（back-ease），切换有“弹起”表现力而非平淡插值
    function easeOutBack(x) {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    // 缓动曲线：平滑进出（用于启动暖机 ramp，0→1 自然生长）
    function easeInOutCubic(x) {
      return x < 0.5
        ? 4 * x * x * x
        : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }
    // 缓动曲线：平滑减速（淡入层用）
    function easeOutCubic(x) {
      return 1 - Math.pow(1 - x, 3);
    }
    // 把进度夹到 [0,1]
    function clamp01(v) {
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }
    // 分段进度：在 [start, start+dur] 内从 0→1，区间外夹到 0/1
    function seg(t, start, dur) {
      return clamp01((t - start) / dur);
    }

    function syncFormButtons() {
      document.querySelectorAll(".form-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.form === vizForm);
      });
    }
    window.CyberFx = {
      // 对话交互：思考→思考形态，输出→输出形态，空闲→默认形态
      thinking() { setForm("thinking"); },
      output() { setForm("output"); },
      idle() { setForm("default"); },
      // 按钮手动切换（带平滑过渡）
      setForm(f) {
        if (["default", "thinking", "output"].indexOf(f) === -1) return;
        if (f === vizForm) return;
        vizFormFrom = vizForm;                       // 从当前目标形态平滑过渡
        vizForm = f;
        formMix = 0;
        formTimer = 0;
        formFlash = 1;                               // 触发切换爆闪
        syncFormButtons();
      },
      getForm() { return vizForm; },
    };
    function setForm(f) { window.CyberFx.setForm(f); }

    // 绑定形态切换按钮
    function bindFormButtons() {
      document.querySelectorAll(".form-btn").forEach((b) => {
        b.addEventListener("click", () => window.CyberFx.setForm(b.dataset.form));
      });
      syncFormButtons();
    }

    // ---------- 尺寸自适应 ----------
    function resizeCanvas() {
      const cssWidth = canvas.clientWidth || window.innerWidth || 1;
      const cssHeight = canvas.clientHeight || window.innerHeight || 1;
      viewWidth = cssWidth;
      viewHeight = cssHeight;

      const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 以 CSS 像素为绘制单位
      renderDpr = dpr;                         // 供文字基线吸附使用
      // 启用 canvas 文字的 optimizeLegibility（字距/连字），提升小字号可读度
      try { ctx.textRendering = "optimizeLegibility"; } catch (e) { /* 旧引擎忽略 */ }

      initDataRain();
      initHackerStream();          // 左侧黑客数据流初始化（依赖 viewWidth/Height）
    }

    // ---------- 边缘数据流（数字雨）----------
    function initDataRain() {
      dataRain = [];
      const columnWidth = 26;
      const perSide = Math.max(2, Math.floor((viewWidth * 0.12) / columnWidth));
      for (let side = 0; side < 2; side++) {
        for (let col = 0; col < perSide; col++) {
          const x = side === 0
            ? 8 + col * columnWidth
            : viewWidth - 8 - col * columnWidth - 12;
          dataRain.push({
            x,
            y: Math.random() * viewHeight,
            speed: randRange(CONFIG.rainSpeedMin, CONFIG.rainSpeedMax),
            length: Math.floor(randRange(6, 16)),
          });
        }
      }
    }

    // 把坐标吸附到设备像素网格：canvas 文字基线落在小数像素上时，
    // 字形会被双线性插值“抹虚”。乘 dpr 取整再除回，可让笔画对齐物理像素。
    const snap = (v) => Math.round(v * renderDpr) / renderDpr;

    function drawDataRain(dt) {
      ctx.save();
      ctx.font = `10px ${FONT_STACK}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,240,255,0.28)";
      for (const drop of dataRain) {
        drop.y += drop.speed * dt;
        if (drop.y > viewHeight + 20) drop.y = -(drop.length * 12);
        let bits = "";
        for (let k = 0; k < drop.length; k++) bits += (Math.random() < 0.5 ? "0" : "1");
        ctx.fillText(bits, drop.x, snap(drop.y));
      }
      ctx.restore();
    }

    // ---------- 左侧黑客数据流（融入背景的氛围特效，非独立边框/面板） ----------
    let hackerStream = [];                 // 活动代码行集合
    const HACKER_FONT = 11;                // 字号（CSS 像素）

    function randHex(len) {
      let s = "";
      for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
      return s;
    }
    const randAddrHack = () => "0x" + randHex(8);

    // 生成单行黑客风格文本（十六进制 / 汇编 / 系统调用混合，长度受控）
    function makeHackerLine() {
      const r = Math.random();
      if (r < 0.34) {
        let b = "";
        for (let i = 0; i < 9; i++) b += randHex(2) + " ";
        return randAddrHack() + ":  " + b;
      } else if (r < 0.64) {
        const ops = ["mov", "push", "pop", "call", "lea", "xor", "cmp", "jmp", "int", "syscall", "ret", "add", "sub"];
        return ops[Math.floor(Math.random() * ops.length)] + " " + randAddrHack() + ", " + randHex(2);
      } else if (r < 0.82) {
        const fns = ["open()", "read()", "mmap()", "fork()", "ioctl()", "recv()", "pthread_create()", "select()"];
        return "[ok] " + fns[Math.floor(Math.random() * fns.length)] + " → " + randHex(4);
      } else if (r < 0.93) {
        const protos = ["TCP", "UDP", "TLS", "SSH"];
        const p = protos[Math.floor(Math.random() * protos.length)];
        return p + " 192.168." + Math.floor(Math.random() * 255) + "." + (Math.floor(Math.random() * 254) + 1) + ":" + (Math.floor(Math.random() * 60000) + 1024);
      }
      const warns = ["auth bypass", "buffer flush", "key exchange", "trace dump", "shell spawn"];
      return "* " + warns[Math.floor(Math.random() * warns.length)];
    }

    function initHackerStream() {
      hackerStream = [];
      const regionTop = hackerPos.y;                  // 跟随拖拽位置
      const regionBottom = viewHeight * 0.60;        // 频谱柱上方、波形左侧
      const lineH = 17;
      const count = Math.max(8, Math.floor((regionBottom - regionTop) / lineH));
      for (let i = 0; i < count; i++) {
        hackerStream.push({
          y: regionTop + i * lineH + Math.random() * lineH,
          speed: 14 + Math.random() * 26,            // 向上漂移速度（px/s）
          text: makeHackerLine(),
          bright: Math.random() < 0.14,              // 偶尔高亮，营造数据闪烁
        });
      }
    }

    function drawHackerStream(dt) {
      if (viewWidth < 640) return;                   // 窄屏不绘制，保持纯净
      const baseRadius = Math.min(viewWidth, viewHeight) * 0.16;
      const regionLeft = hackerPos.x;                 // 可拖拽偏移
      const regionRight = Math.max(regionLeft + 120, (viewWidth / 2) - baseRadius - 28);
      const regionTop = hackerPos.y;                  // 可拖拽偏移
      const regionBottom = viewHeight * 0.60;

      ctx.save();
      ctx.font = HACKER_FONT + "px " + FONT_STACK;
      ctx.textBaseline = "top";
      for (const line of hackerStream) {
        line.y -= line.speed * dt;
        if (line.y < regionTop - HACKER_FONT) {
          line.y = regionBottom;                     // 漂出顶部后从底部重生
          line.text = makeHackerLine();
          line.bright = Math.random() < 0.14;
        }
        let txt = line.text;
        const maxW = regionRight - regionLeft - 6;
        while (txt.length > 4 && ctx.measureText(txt).width > maxW) txt = txt.slice(0, -1);
        ctx.fillStyle = line.bright ? "rgba(0,255,136,0.42)" : "rgba(0,255,136,0.16)"; // 低调绿色
        ctx.fillText(txt, regionLeft, snap(line.y));
      }
      ctx.restore();
    }

    // ---------- 黑客数据流拖拽控制器（位置可调 + localStorage 持久化） ----------
    const HACKER_LS_KEY = "cyber-hacker-pos-v1";
    const hackerDragZone = document.getElementById("hackerDragZone");
    let hackerPos = { x: 296, y: 88 };            // 数据流区域左上角偏移（默认坐标 296,88）
    let hackerDrag = null;                          // 拖拽状态

    // 从 localStorage 恢复位置（容错）；已重置为默认位置
    function loadHackerPos() {
      try { localStorage.removeItem(HACKER_LS_KEY); } catch (e) { /* ignore */ }
      return null;                                       // 强制使用默认 {x:296, y:88}
    }
    function saveHackerPos() {
      try { localStorage.setItem(HACKER_LS_KEY, JSON.stringify(hackerPos)); } catch (e) { /* 忽略 */ }
    }

    // 更新拖拽区域 DOM 位置/尺寸（与绘制区域同步）
    function syncHackerDragZone() {
      if (!hackerDragZone) return;
      const baseRadius = Math.min(viewWidth, viewHeight) * 0.16;
      const zoneW = Math.max(120, (viewWidth / 2) - baseRadius - 28 - hackerPos.x);
      const zoneH = (viewHeight * 0.60) - hackerPos.y;
      hackerDragZone.style.left = hackerPos.x + "px";
      hackerDragZone.style.top = hackerPos.y + "px";
      hackerDragZone.style.width = Math.max(80, zoneW) + "px";
      hackerDragZone.style.height = Math.max(120, zoneH) + "px";
    }

    // 拖拽事件
    function onHackerDragStart(e) {
      if (!hackerDragZone) return;
      if (e.button !== undefined && e.button !== 0) return;     // 仅左键
      /* dev-mode 下点击 dev-label 时跳过拖拽，让复制事件正常触发 */
      if (e.target.closest && e.target.closest(".dev-label")) return;
      hackerDrag = { px: e.clientX, py: e.clientY, ox: hackerPos.x, oy: hackerPos.y };
      hackerDragZone.classList.add("dragging");
      hackerDragZone.setPointerCapture(e.pointerId);
      window.addEventListener("pointermove", onHackerDragMove);
      window.addEventListener("pointerup", onHackerDragEnd, { once: true });
      e.preventDefault();
    }
    function onHackerDragMove(e) {
      if (!hackerDrag || !hackerDragZone) return;
      const dx = e.clientX - hackerDrag.px;
      const dy = e.clientY - hackerDrag.py;
      const vw = window.innerWidth, vh = window.innerHeight;
      hackerPos.x = Math.max(-100, Math.min(vw * 0.6, hackerDrag.ox + dx));
      hackerPos.y = Math.max(40, Math.min(vh - 150, hackerDrag.oy + dy));
      syncHackerDragZone();
    }
    function onHackerDragEnd() {
      hackerDrag = null;
      if (hackerDragZone) hackerDragZone.classList.remove("dragging");
      window.removeEventListener("pointermove", onHackerDragMove);
      saveHackerPos();                                   // 松手保存
    }

    function initHackerDrag() {
      const saved = loadHackerPos();
      if (saved) { hackerPos.x = saved.x; hackerPos.y = saved.y; }
      syncHackerDragZone();
      if (hackerDragZone) {
        hackerDragZone.addEventListener("pointerdown", onHackerDragStart);
      }
      window.addEventListener("resize", () => {
        const vw = window.innerWidth, vh = window.innerHeight;
        hackerPos.x = Math.min(hackerPos.x, vw * 0.6);
        hackerPos.y = Math.min(hackerPos.y, vh - 150);
        syncHackerDragZone();
      });
    }

    // ---------- 模拟频谱与环形波形数据（委托共享引擎） ----------
    function simulateSpectrum(dt) {
      window.SpectrumEngine.simulateSpectrum(spectrumState, dt);
    }

    // ---------- 绘制辅助：顶部圆角矩形 ----------
    function drawRoundedTopRect(x, y, w, h, radius) {
      const r = Math.min(radius, w / 2, h);
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
    }

    // ---------- 故障撕裂（glitch）效果 ----------
    function renderGlitch(dt) {
      if (spectrumState.glitchCountdown <= 0 && Math.random() < CONFIG.glitchChance) {
        spectrumState.glitchCountdown = randRange(0.08, 0.18);
      }
      if (spectrumState.glitchCountdown <= 0) return;

      spectrumState.glitchCountdown -= dt;

      const tears = 5;
      const sy = Math.random() * viewHeight;
      const sh = randRange(8, 34);
      const dx = (Math.random() - 0.5) * 46;
      ctx.drawImage(canvas, 0, sy, viewWidth, sh, dx, sy, viewWidth, sh);
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 3; i++) {
        const sy = Math.random() * viewHeight;
        const sh = randRange(6, 22);
        ctx.fillStyle = i % 2 ? "rgba(0,240,255,0.16)" : "rgba(255,43,214,0.16)";
        ctx.fillRect(0, sy, viewWidth, sh);
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // ---------- 频谱柱（形态间“形变”过渡：逐柱插值高度/发光/色相，而非淡入淡出） ----------
    function barStyle(form, i, t) {
      const n = CONFIG.barCount > 1 ? i / (CONFIG.barCount - 1) : 0;
      if (form === "thinking") {
        // 思考：冷静青色，平滑流动的缓慢正弦波
        const w = 0.24 + 0.17 * Math.sin(i * 0.30 - t * 2.4) + 0.05 * Math.sin(i * 0.12 + t * 1.4);
        return { h: Math.max(0.02, w), glow: 5, topA: 0.45, peakA: 0, hue: 195, s0: 80, l0: 60, s1: 75, l1: 38 };
      } else if (form === "output") {
        // 输出：炽热红橙 + 高速行进尖刺 + 节拍脉冲（高能喷涌，与默认态强区分）
        const beat = 0.5 + 0.5 * Math.sin(t * 7.0);
        const spike = 0.30 * Math.max(0, Math.sin(i * 0.20 - t * 9.0));
        const h = Math.min(1, barLevels[i] * 1.30 + spike + 0.12 * beat);
        const hue = 6 + 16 * n;            // 红→橙，炽热
        return { h, glow: 18, topA: 0.95, peakA: 0.85, hue, s0: 100, l0: 66, s1: 96, l1: 46 };
      } else {
        // 默认/待命：冷紫蓝，缓慢呼吸的相干波形（平稳监听，与输出态强区分）
        const breathe = 0.26 + 0.10 * barLevels[i] + 0.08 * Math.sin(i * 0.18 - t * 1.1);
        const hue = 255 + 40 * n;          // 蓝→紫，冷静
        return { h: Math.max(0.04, breathe), glow: 9, topA: 0.5, peakA: 0.35, hue, s0: 85, l0: 58, s1: 80, l1: 40 };
      }
    }

    function drawSpectrumBars(formFrom, formTo, e, dt, bootT) {
      const baseY = viewHeight;                 // 贴底对齐：基线落在容器底部边缘，不留底部留白
      const gap = viewWidth * 0.004;
      const barWidth = (viewWidth * 0.90 - gap * (CONFIG.barCount - 1)) / CONFIG.barCount;
      const startX = viewWidth * 0.05;
      const maxHeight = viewHeight * 0.30;
      const t = fxState.t;

      // 基线发光网格线（贴底，画在底边上）
      ctx.save();
      ctx.strokeStyle = "rgba(0,240,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(viewWidth * 0.05, baseY);
      ctx.lineTo(viewWidth * 0.95, baseY);
      ctx.stroke();
      ctx.restore();

      for (let i = 0; i < CONFIG.barCount; i++) {
        const x = startX + i * (barWidth + gap);

        // 入场：自基线逐根向上生长（左→右扫描 + 回弹），bootT=1 时完全长成
        const norm = i / (CONFIG.barCount - 1);            // 0(左)→1(右)
        const barGrow = bootT >= 1 ? 1 : easeOutBack(seg(bootT, 0.16 + norm * 0.22, 0.30));

        const A = barStyle(formFrom, i, t);
        const B = barStyle(formTo, i, t);
        const hNorm = A.h + (B.h - A.h) * e;
        const glow = A.glow + (B.glow - A.glow) * e + formFlash * 16;
        const topA = Math.min(1, A.topA + (B.topA - A.topA) * e + formFlash * 0.35);
        const peakA = A.peakA + (B.peakA - A.peakA) * e;
        const hue = A.hue + (B.hue - A.hue) * e;
        const s0 = A.s0 + (B.s0 - A.s0) * e, l0 = A.l0 + (B.l0 - A.l0) * e;
        const s1 = A.s1 + (B.s1 - A.s1) * e, l1 = A.l1 + (B.l1 - A.l1) * e;

        const h = Math.max(0.02, hNorm) * maxHeight * barGrow;
        const c0 = `hsl(${hue}, ${s0}%, ${l0}%)`;
        const c1 = `hsl(${hue}, ${s1}%, ${l1}%)`;

        const gradient = ctx.createLinearGradient(0, baseY - h, 0, baseY);
        gradient.addColorStop(0, c0);
        gradient.addColorStop(1, c1);

        ctx.save();
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        ctx.shadowBlur = glow;
        ctx.fillStyle = gradient;
        drawRoundedTopRect(x, baseY - h, barWidth, h, Math.min(barWidth / 2, 4));
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = `hsla(${hue}, 100%, 88%, ${topA})`;
        ctx.fillRect(x, baseY - h, barWidth, 2);
        ctx.restore();

        if (peakA > 0.01) {
          const peakY = baseY - barPeaks[i] * maxHeight * barGrow;
          ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${peakA})`;
          ctx.fillRect(x, peakY - 2, barWidth, 1.5);
        }
      }
    }

    // ---------- 中央环形波形（形态间“形变”过渡：半径/旋转/色相/签名特效插值） ----------
    function ringStyle(form, t, energy, baseRadius) {
      if (form === "thinking") return { amplitude: baseRadius * 0.14, rot: t * 0.6, lineW: 2, glow: 7, hue: 195, light: 58, sat: 90 };
      if (form === "output") {
        // 输出：大振幅 + 快速旋转 + 高频脉冲（炽热喷涌，与默认态强区分）
        const throb = 1 + 0.22 * Math.sin(t * 8.0);
        return { amplitude: baseRadius * (0.30 + energy * 0.5) * throb, rot: t * 2.4, lineW: 3.4, glow: 18, hue: 8, light: 62, sat: 96 };
      }
      // 默认/待命：小振幅 + 极慢漂移（平稳监听，冷紫，与输出态强区分）
      return { amplitude: baseRadius * (0.14 + energy * 0.16), rot: t * 0.22, lineW: 2.4, glow: 10, hue: 278, light: 60, sat: 92 };
    }
    function ringRadius(form, j, t, baseRadius, amplitude) {
      if (form === "thinking") {
        const breathe = 1 + 0.06 * Math.sin(t * 2 + j * 0.5);
        return baseRadius * breathe;
      }
      return baseRadius + (ringSamples[j] - 0.5) * amplitude * 2;
    }

    function drawRingWave(formFrom, formTo, e, dt, centerX, centerY, energy, ringArc, ringBloom) {
      const t = fxState.t;
      const baseRadius = Math.min(viewWidth, viewHeight) * 0.16;
      const ringScale = (1 + formFlash * 0.06) * ringBloom;   // 切换爆闪放大 × 入场绽放（自圆心 0→1）

      const sf = ringStyle(formFrom, t, energy, baseRadius);
      const st = ringStyle(formTo, t, energy, baseRadius);
      const amplitude = sf.amplitude + (st.amplitude - sf.amplitude) * e;
      const rot = sf.rot + (st.rot - sf.rot) * e;
      const lineW = sf.lineW + (st.lineW - sf.lineW) * e;
      const glow = sf.glow + (st.glow - sf.glow) * e + formFlash * 16;
      const ringLight = sf.light + (st.light - sf.light) * e;
      const sat = sf.sat + (st.sat - sf.sat) * e;

      // 光晕底（随绽放从圆心展开）
      const disc = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.2, centerX, centerY, baseRadius * 1.3);
      disc.addColorStop(0, "rgba(177,75,255,0.06)");
      disc.addColorStop(1, "rgba(0,240,255,0)");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.3 * ringBloom, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.shadowColor = "rgba(0,240,255,0.7)";
      ctx.shadowBlur = glow;
      ctx.lineWidth = lineW;
      ctx.lineCap = "round";
      // 入场：仅绘制首 ringArc 比例的弧段 → 波形自顶部顺时针“描边成形”
      const ringCount = Math.ceil(ringArc * CONFIG.ringSegments);
      for (let j = 0; j < ringCount; j++) {
        const a0 = (j / CONFIG.ringSegments) * Math.PI * 2 - Math.PI / 2 + rot;
        const a1 = ((j + 1) / CONFIG.ringSegments) * Math.PI * 2 - Math.PI / 2 + rot;
        const r0 = (ringRadius(formFrom, j, t, baseRadius, amplitude) * (1 - e)
          + ringRadius(formTo, j, t, baseRadius, amplitude) * e) * ringScale;
        const r1 = (ringRadius(formFrom, j + 1, t, baseRadius, amplitude) * (1 - e)
          + ringRadius(formTo, j + 1, t, baseRadius, amplitude) * e) * ringScale;
        // 环按形态纯色（思考青 / 默认紫 / 输出红），避免默认与输出同为彩虹而难以分辨
        const hFrom = sf.hue;
        const hTo = st.hue;
        const hueSeg = hFrom + (hTo - hFrom) * e;
        ctx.strokeStyle = `hsl(${hueSeg}, ${sat}%, ${ringLight}%)`;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(a0) * r0, centerY + Math.sin(a0) * r0);
        ctx.lineTo(centerX + Math.cos(a1) * r1, centerY + Math.sin(a1) * r1);
        ctx.stroke();
      }
      ctx.restore();

      // 思考签名：旋转扫描弧（随“思考占比”淡入淡出，融入形变而非硬切）
      const pThink = (formTo === "thinking") ? e : (formFrom === "thinking" ? 1 - e : 0);
      if (pThink > 0.01) {
        const ang = (t * 2.4) % (Math.PI * 2);
        const sweep = Math.PI * 0.4;
        const r = baseRadius * 1.5 * ringScale;
        ctx.save();
        ctx.lineCap = "round"; ctx.lineWidth = 3;
        ctx.shadowColor = "rgba(0,240,255,0.8)"; ctx.shadowBlur = 12;
        const g = ctx.createLinearGradient(
          centerX + Math.cos(ang) * r, centerY + Math.sin(ang) * r,
          centerX + Math.cos(ang + sweep) * r, centerY + Math.sin(ang + sweep) * r);
        g.addColorStop(0, "rgba(0,240,255,0)");
        g.addColorStop(1, `rgba(0,240,255,${0.9 * pThink})`);
        ctx.strokeStyle = g;
        ctx.beginPath(); ctx.arc(centerX, centerY, r, ang, ang + sweep); ctx.stroke();
        ctx.restore();
      }

      // 输出签名：扩散同心涟漪（随“输出占比”淡入淡出）
      const pOut = (formTo === "output") ? e : (formFrom === "output" ? 1 - e : 0);
      if (pOut > 0.01) {
        for (let k = 0; k < 2; k++) {
          const phase = (t * 0.9 + k * 0.5) % 1;
          const r = (baseRadius * 1.2 + phase * baseRadius * 2.2) * ringScale;
          const alpha = (1 - phase) * 0.4 * pOut;
          ctx.save();
          ctx.lineWidth = 2;
          ctx.strokeStyle = (k % 2) ? `rgba(255,43,214,${alpha})` : `rgba(0,240,255,${alpha})`;
          ctx.beginPath(); ctx.arc(centerX, centerY, r, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }

      // 中心能量核（输出形态更亮）
      const pOutCore = (formTo === "output") ? e : (formFrom === "output" ? 1 - e : 0);
      const pulse = baseRadius * (0.06 + energy * 0.08) * (1 + 0.4 * pOutCore + formFlash * 0.6) * ringBloom;
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, pulse);
      core.addColorStop(0, "rgba(255,255,255,0.95)");
      core.addColorStop(0.5, "rgba(0,240,255,0.8)");
      core.addColorStop(1, "rgba(177,75,255,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---------- HUD 数值节流刷新 ----------
    let hudAccumulator = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let fpsValue = 0;

    function updateHud(dt) {
      fpsAccumulator += dt;
      fpsFrames += 1;
      hudAccumulator += dt;

      if (hudAccumulator >= 0.25) {
        fpsValue = fpsAccumulator > 0 ? Math.round(fpsFrames / fpsAccumulator) : 0;
        if (hudNodes.energy) hudNodes.energy.textContent = `${Math.round(spectrumState.energy * 100)}%`;
        if (hudNodes.peak) hudNodes.peak.textContent = `${Math.round(spectrumState.peak * 100)}%`;
        if (hudNodes.fps) hudNodes.fps.textContent = fpsValue;

        hudAccumulator = 0;
        fpsAccumulator = 0;
        fpsFrames = 0;
      }
    }

    // ---------- 主渲染 ----------
    function render(dt) {
      // 入场进度 bootT：booted 后 0→1，驱动各图层“从无到有”的分层生成
      let bootT = 0;
      if (document.body.classList.contains("booted")) {
        if (!bootRampStart) bootRampStart = performance.now();
        bootT = clamp01((performance.now() - bootRampStart) / BOOT_REVEAL);
      }

      fxState.t += dt;
      if (formMix < 1) {
        formTimer += dt;
        formMix = Math.min(1, formTimer / FORM_DUR);
      }
      formFlash = Math.max(0, formFlash - dt * 2.2);   // 爆闪约 0.45s 衰减

      // 分层入场曲线（bootT 0→1 内错落展开）：
      //   数据雨 / 黑客流 —— 纯淡入（氛围层）
      //   fx-bars         —— 自基线逐根生长（左→右扫描 + 回弹），见 drawSpectrumBars
      //   fx-ring         —— 自圆心绽放(半径) + 顺时针描边成形(弧长)，见 drawRingWave
      //   故障层          —— 最后浮现
      const rainA = easeOutCubic(seg(bootT, 0.00, 0.45));
      const hackerA = easeOutCubic(seg(bootT, 0.06, 0.45));
      const barsA = easeOutCubic(seg(bootT, 0.16, 0.55));
      const ringA = easeOutCubic(seg(bootT, 0.30, 0.62));
      const ringArc = easeInOutCubic(seg(bootT, 0.30, 0.66));   // 0→1：环波形顺时针描出
      const ringBloom = easeOutBack(seg(bootT, 0.30, 0.62));    // 0→1：自圆心绽放（带过冲）
      const glitchA = easeOutCubic(seg(bootT, 0.52, 0.40));

      ctx.clearRect(0, 0, viewWidth, viewHeight);
      ctx.globalAlpha = rainA;
      drawDataRain(dt);
      ctx.globalAlpha = hackerA;
      drawHackerStream(dt);        // 左侧黑客数据流（背景氛围层）

      const centerX = viewWidth / 2;
      const centerY = viewHeight * 0.40;
      const energy = spectrumState.energy;

      // 形态过渡：不再淡入淡出，而是“形变”——逐柱 / 逐段插值几何与样式参数，
      // 带过冲的回弹缓动（easeOutBack）+ 切换爆闪，让状态变更清晰可感
      const e = easeOutBack(formMix);
      ctx.globalAlpha = barsA;
      drawSpectrumBars(vizFormFrom, vizForm, e, dt, bootT);
      ctx.globalAlpha = ringA;
      drawRingWave(vizFormFrom, vizForm, e, dt, centerX, centerY, energy, ringArc, ringBloom);

      ctx.globalAlpha = glitchA;
      renderGlitch(dt);
      ctx.globalAlpha = 1;
    }

    // ---------- 主循环 ----------
    function animationLoop(timestamp) {
      if (!lastTimestamp) lastTimestamp = timestamp;
      let dt = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      dt = clamp(dt, 0, 0.05); // 限制单帧步长，防止切后台回来后的跳变

      simulateSpectrum(dt);
      render(dt);
      updateHud(dt);
      requestAnimationFrame(animationLoop);
    }

    // ---------- 事件绑定 ----------
    function bindEvents() {
      window.addEventListener("resize", resizeCanvas);
      // 标签页重新可见时重置时间戳，避免 dt 因长时间挂起而异常
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) lastTimestamp = 0;
      });
    }

    // ---------- 启动 ----------
    function init() {
      resizeCanvas();
      bindEvents();
      initHackerDrag();                              // 初始化黑客数据流拖拽（恢复位置+绑定事件）
      bindFormButtons();                             // 绑定可视化形态切换按钮
      // 预热若干帧，避免开场出现空白
      for (let i = 0; i < 30; i++) simulateSpectrum(0.016);
      requestAnimationFrame(animationLoop);
    }

    init();
  }, []);
}
