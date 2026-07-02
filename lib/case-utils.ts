import type { QccCase } from "./types";
import { makeId } from "./ids";

export function emptyStep(order: number) {
  return { id: makeId("step"), order, name: "", owner: "", input: "", activity: "", output: "", standard: "", anomaly: "" };
}

export function createEmptyCase(): QccCase {
  const now = new Date().toISOString();
  return {
    id: makeId("case"), title: "未命名改善课题", problemType: "质量", object: "", location: "", period: "",
    frequency: "", impact: "", metric: "", baseline: "", target: "", dataDefinition: "", processStart: "",
    processEnd: "", processOwner: "", sanitizedConfirmed: false,
    steps: Array.from({ length: 5 }, (_, index) => emptyStep(index + 1)), findings: [], hypotheses: [], countermeasures: [],
    stage: 1, status: "草稿", createdAt: now, updatedAt: now,
  };
}

export function readinessIssues(item: QccCase): string[] {
  const issues: string[] = [];
  if (!item.title.trim() || item.title === "未命名改善课题") issues.push("请填写课题名称");
  if (!item.object.trim()) issues.push("请说明问题对象");
  if (!item.location.trim()) issues.push("请说明发生地点或流程环节");
  if (!item.period.trim()) issues.push("请填写问题统计时间范围");
  if (!item.frequency.trim()) issues.push("请提供频次或差距数据");
  if (!item.impact.trim()) issues.push("请说明经营影响");
  if (!item.metric.trim() || !item.baseline.trim()) issues.push("请提供核心指标和基线值");
  if (!item.dataDefinition.trim()) issues.push("请说明指标统计口径");
  if (!item.processStart.trim() || !item.processEnd.trim()) issues.push("请明确流程起点和终点");
  const completeSteps = item.steps.filter((step) => step.name.trim() && step.activity.trim());
  if (completeSteps.length < 5) issues.push("请至少填写5个有效流程步骤");
  if (!item.sanitizedConfirmed) issues.push("请确认资料已经脱敏");
  return issues;
}

export function caseProgress(item: QccCase): number {
  const base = readinessIssues(item).length === 0 ? 20 : 8;
  const diagnosis = item.findings.length ? 25 : 0;
  const verification = item.hypotheses.length ? 25 : 0;
  const supported = item.hypotheses.some((h) => h.status === "证据支持") ? 12 : 0;
  const solutions = item.countermeasures.length ? 18 : 0;
  return Math.min(100, base + diagnosis + verification + supported + solutions);
}
