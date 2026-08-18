// 冒烟测试：真实启动 mcp-memory.mjs（stdio），验证记录模型 + search_memory 召回。
// 用 test_ 前缀 key 写入并最后删除，不污染真实记忆库。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "server", "mcp-memory.mjs");

const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
let resolveReady;
const ready = new Promise((r) => (resolveReady = r));

child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const fn = pending.get(msg.id);
      pending.delete(msg.id);
      fn(msg);
    }
  }
});

function rpc(method, params, id) {
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 8000);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const testKeys = ["test_user_lang", "test_proj_sound"];
let failed = false;
function check(cond, msg) {
  if (!cond) { failed = true; console.error("  FAIL:", msg); }
  else console.log("  ok:", msg);
}

(async () => {
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0" },
    }, 1);
    check(init.result && init.result.serverInfo && init.result.serverInfo.name === "jarvis-memory", "initialize 返回 jarvis-memory");
    notify("notifications/initialized", {});

    // 写入记录模型（带 type / importance）
    const s1 = await rpc("tools/call", { name: "save_memory", arguments: { key: testKeys[0], value: "用户偏好简体中文", type: "semantic", importance: 0.9 } }, 2);
    check(!s1.result.isError, "save_memory(test_user_lang) 成功");
    const s2 = await rpc("tools/call", { name: "save_memory", arguments: { key: testKeys[1], value: "sound 项目是 AI 音频生成 demo", type: "semantic" } }, 3);
    check(!s2.result.isError, "save_memory(test_proj_sound) 成功");

    // 检索：应命中 test_user_lang（语言相关）
    const q = await rpc("tools/call", { name: "search_memory", arguments: { query: "用户用什么语言", limit: 5 } }, 4);
    check(!q.result.isError, "search_memory 调用成功");
    const ents = q.result.structuredContent && q.result.structuredContent.entries;
    check(Array.isArray(ents) && ents.length >= 1, "search_memory 返回条目（命中≥1）");
    check(ents.some((e) => e.key === testKeys[0]), "召回命中 test_user_lang（语义相关）");
    check(ents.every((e) => typeof e.score === "number"), "返回条目含 score 字段");

    // 不相关查询应返回空
    const q2 = await rpc("tools/call", { name: "search_memory", arguments: { query: "zzzqqq_nomatch_xyz" } }, 5);
    const ents2 = q2.result.structuredContent && q2.result.structuredContent.entries;
    check(Array.isArray(ents2) && ents2.length === 0, "无关查询返回空（不污染上下文）");

    // 清理测试 key
    for (let i = 0; i < testKeys.length; i++) {
      await rpc("tools/call", { name: "delete_memory", arguments: { key: testKeys[i] } }, 10 + i);
    }
    const lst = await rpc("tools/call", { name: "list_memories", arguments: {} }, 20);
    const left = (lst.result.structuredContent && lst.result.structuredContent.entries) || [];
    check(!left.some((e) => testKeys.includes(e.key)), "测试 key 已清理（真实记忆库无残留）");

    console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
    child.kill();
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error("ERROR:", e.message);
    child.kill();
    process.exit(1);
  }
})();
