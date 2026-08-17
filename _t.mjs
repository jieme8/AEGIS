import { renderMovieResults, parseCommand } from "./src/lib/movieSearch.js";
const fb = {
  query: "九门2026", keyword: "影视搜索",
  summary: "未连接到实时检索代理，以下仅为检索入口（无法返回真实网页结果）。请运行 `npm run dev:all`（而非仅 `npm run dev`）以启用真实检索，或手动点击下列入口检索。",
  groups: [{ kind:"kb", title:"阶段零", note:"", items:[{title:"x",url:"https://e.com",rating:"良好",meta:"m",flags:[],source:"s"}] }],
  tips: [], warnings: [], live: false,
};
const html = renderMovieResults(fb);
console.log("offline badge present:", /离线 · 仅检索入口/.test(html));
console.log("live badge absent:", !/含实时检索结果/.test(html));
console.log("honest summary present:", /未连接到实时检索代理/.test(html));
console.log("parse @影视搜索 九门2026:", JSON.stringify(parseCommand("@影视搜索 九门2026")));
console.log("parse @影视 九门2026 (no match):", JSON.stringify(parseCommand("@影视 九门2026")));
