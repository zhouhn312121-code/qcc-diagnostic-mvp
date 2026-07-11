import type { ProcessStep, ProcessTransition, QccCase } from "./types";
import { makeId } from "./ids";

export function emptyStep(order: number) {
  return { id: makeId("step"), order, name: "", owner: "", input: "", activity: "", output: "", standard: "", anomaly: "", nodeType: "ACTION" as const, routingMode: "AUTO_NEXT" as const, decisionTitle: "", decisionBasis: "" };
}

export function emptyEndStep(order: number): ProcessStep {
  return { ...emptyStep(order), name: "流程结束", nodeType: "END", routingMode: "SPECIFIED" };
}

export function defaultTransitions(steps: ProcessStep[]): ProcessTransition[] {
  return steps.slice(0, -1).filter((step) => step.nodeType !== "END").map((step, index) => ({
    id: makeId("transition"), sourceNodeId: step.id, targetNodeId: steps[index + 1].id,
    transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1,
  }));
}

export function normalizeCase(item: QccCase): QccCase {
  const rawSteps = Array.isArray(item.steps) ? item.steps : [];
  const steps = rawSteps.map((step, index) => ({
    ...step, order: index + 1, nodeType: step.nodeType || "ACTION", routingMode: step.routingMode || "AUTO_NEXT",
    decisionTitle: step.decisionTitle || "", decisionBasis: step.decisionBasis || "",
  })) as ProcessStep[];
  if (!steps.some((step) => step.nodeType === "END")) steps.push(emptyEndStep(steps.length + 1));
  const transitions = Array.isArray(item.transitions)
    ? item.transitions.filter((transition) => steps.some((step) => step.id === transition.sourceNodeId) && steps.some((step) => step.id === transition.targetNodeId))
    : defaultTransitions(steps);
  return { ...item, steps, transitions, version: Number.isInteger(item.version) && item.version > 0 ? item.version : 1 };
}

export function syncAutoTransitions(item: QccCase): QccCase {
  const explicit = item.transitions.filter((transition) => {
    const source = item.steps.find((step) => step.id === transition.sourceNodeId);
    return source?.routingMode !== "AUTO_NEXT" || source.nodeType === "DECISION";
  });
  const automatic = item.steps.slice(0, -1).filter((step) => step.nodeType === "ACTION" && step.routingMode === "AUTO_NEXT").map((step) => {
    const index = item.steps.findIndex((candidate) => candidate.id === step.id);
    const existing = item.transitions.find((transition) => transition.sourceNodeId === step.id && transition.transitionType === "DEFAULT");
    return { id: existing?.id || makeId("transition"), sourceNodeId: step.id, targetNodeId: item.steps[index + 1].id, transitionType: "DEFAULT" as const, branchName: "", conditionExpression: "", isDefault: true, order: 1 };
  });
  return { ...item, transitions: [...explicit, ...automatic] };
}

export function processIssues(item: QccCase): string[] {
  const issues: string[] = [];
  const ids = new Set(item.steps.map((step) => step.id));
  for (const step of item.steps) {
    const outgoing = item.transitions.filter((transition) => transition.sourceNodeId === step.id);
    if (step.nodeType === "END" && outgoing.length) issues.push(`${step.name || `步骤${step.order}`}是结束节点，不能配置后续流转`);
    if (step.nodeType === "ACTION" && outgoing.length !== 1) issues.push(`${step.name || `步骤${step.order}`}需要配置一个后续步骤`);
    if (step.nodeType === "DECISION") {
      if (outgoing.length < 2 || outgoing.length > 6) issues.push(`${step.name || `步骤${step.order}`}需要配置2–6个判断分支`);
      const names = outgoing.map((transition) => transition.branchName.trim());
      if (names.some((name) => !name)) issues.push(`${step.name || `步骤${step.order}`}存在未命名分支`);
      if (new Set(names).size !== names.length) issues.push(`${step.name || `步骤${step.order}`}的分支名称不能重复`);
    }
    for (const transition of outgoing) {
      if (!ids.has(transition.targetNodeId)) issues.push(`${step.name || `步骤${step.order}`}存在无效目标步骤`);
      if (transition.targetNodeId === step.id) issues.push(`${step.name || `步骤${step.order}`}不能流转到自身`);
    }
  }
  const reachable = new Set<string>(); const queue = item.steps[0] ? [item.steps[0].id] : [];
  while (queue.length) {
    const id = queue.shift()!; if (reachable.has(id)) continue; reachable.add(id);
    item.transitions.filter((transition) => transition.sourceNodeId === id).forEach((transition) => queue.push(transition.targetNodeId));
  }
  item.steps.filter((step) => !reachable.has(step.id)).forEach((step) => issues.push(`${step.name || `步骤${step.order}`}无法从流程起点到达`));
  return [...new Set(issues)];
}

export function hasProcessLoop(item: QccCase): boolean {
  const visited = new Set<string>(); const active = new Set<string>();
  function visit(id: string): boolean {
    if (active.has(id)) return true; if (visited.has(id)) return false;
    visited.add(id); active.add(id);
    const loop = item.transitions.filter((transition) => transition.sourceNodeId === id).some((transition) => visit(transition.targetNodeId));
    active.delete(id); return loop;
  }
  return item.steps.some((step) => visit(step.id));
}

export function createEmptyCase(): QccCase {
  const now = new Date().toISOString();
  return syncAutoTransitions(normalizeCase({
    id: makeId("case"), title: "未命名改善课题", problemType: "质量", object: "", location: "", period: "",
    frequency: "", impact: "", metric: "", baseline: "", target: "", dataDefinition: "", processStart: "",
    processEnd: "", processOwner: "", sanitizedConfirmed: false,
    steps: [...Array.from({ length: 5 }, (_, index) => emptyStep(index + 1)), emptyEndStep(6)], transitions: [], findings: [], hypotheses: [], countermeasures: [],
    stage: 1, status: "草稿", createdAt: now, updatedAt: now,
    version: 1,
  }));
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
  issues.push(...processIssues(item));
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
