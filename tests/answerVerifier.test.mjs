import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyAnswer, TIME_SENSITIVE_RE } from "../src/lib/answerVerifier.js";

test("TIME_SENSITIVE_RE 命中「最新/现在」时效问题", () => {
  assert.ok(TIME_SENSITIVE_RE.test("上海现在最新的社平工资是多少"));
  assert.ok(TIME_SENSITIVE_RE.test("2026年社保缴费基数是多少"));
  assert.ok(TIME_SENSITIVE_RE.test("本年度平均工资发布了吗"));
});

test("TIME_SENSITIVE_RE 不命中普通闲聊", () => {
  assert.equal(TIME_SENSITIVE_RE.test("帮我推荐一部好看的电影"), false);
  assert.equal(TIME_SENSITIVE_RE.test("介绍一下赛博朋克风格"), false);
});

test("时效问题 + 数值断言但无来源链接 → 强制降为 low 并给出过期风险警告", () => {
  const report = verifyAnswer({
    text: "最新上海社平工资是 12,577 元/月，同比上涨 1.15%。缴费基数上限为 37,731 元，下限为 7,546 元。",
    query: "上海现在最新的社平工资是多少",
    timeSensitive: true,
  });
  assert.equal(report.timeSensitive, true);
  assert.equal(report.level, "low");
  assert.ok(report.warnings.some((w) => w.includes("时效数据风险")), "应有时效数据风险警告");
  assert.equal(report.sourceCount, 0);
});

test("时效问题 + 无来源但模型主动声明不确定性 → 不强制降级（有诚实声明加分）", () => {
  const report = verifyAnswer({
    text: "我无法确认最新数字，我的训练知识截至此前，上海社平工资请以官方发布为准，我记忆中是 12,434 元。",
    query: "上海现在最新的社平工资是多少",
    timeSensitive: true,
  });
  assert.equal(report.hasUncertainty, true);
  assert.ok(report.level !== "low" || report.warnings.some((w) => w.includes("时效数据风险")), "声明不确定后不应强降级或仍提醒");
});

test("非时效问题 + 无来源 → 不受时效降级影响", () => {
  const report = verifyAnswer({
    text: "赛博朋克起源于 20 世纪 80 年代的科幻文学运动，代表作有《神经漫游者》。",
    query: "介绍一下赛博朋克",
    timeSensitive: false,
  });
  assert.equal(report.timeSensitive, false);
  assert.ok(!report.warnings.some((w) => w.includes("时效数据风险")), "非时效问题不应出现时效风险警告");
});

test("时效问题 + 附真实来源链接 → 保持高分不降级", () => {
  const report = verifyAnswer({
    text: "上海市 2025 年度全口径平均工资为 12,577 元/月，来源：[上海市人社局](https://rsj.sh.gov.cn) 发布于 2026-08-18。",
    query: "上海现在最新的社平工资是多少",
    timeSensitive: true,
  });
  assert.equal(report.timeSensitive, true);
  assert.ok(report.sourceCount > 0, "应提取到来源链接");
  assert.notEqual(report.level, "low", "有时效真实来源不应降级");
});