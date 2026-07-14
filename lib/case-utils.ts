import type { ProcessStep, ProcessTransition, QccCase } from "./types";
import { makeId } from "./ids";

export function emptyStep(order: number) {
  return { id: makeId("step"), order, name: "", owner: "", input: "", activity: "", output: "", standard: "", anomaly: "", nodeType: "ACTION" as const, routingMode: "AUTO_NEXT" as const, decisionTitle: "", decisionBasis: "", positionX: 80 + (order - 1) * 220, positionY: 120, lane: "", participants: "", decisionRole: "", escalationRole: "", systemTools: "", dataSource: "", entryMethod: "", duplicateEntry: "", systemOutput: "", automationControl: "", offlineWork: "", normalRule: "", exceptionRule: "", escalationRule: "", closureRule: "", policyReference: "" };
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
    ...emptyStep(index + 1), ...step, order: index + 1, nodeType: step.nodeType || "ACTION", routingMode: step.routingMode || "AUTO_NEXT",
    decisionTitle: step.decisionTitle || "", decisionBasis: step.decisionBasis || "",
    positionX: Number.isFinite(step.positionX) ? step.positionX : 80 + index * 220,
    positionY: Number.isFinite(step.positionY) ? step.positionY : 120,
    lane: step.lane || step.owner || "",
  })) as ProcessStep[];
  if (!steps.some((step) => step.nodeType === "END")) steps.push(emptyEndStep(steps.length + 1));
  const transitions = Array.isArray(item.transitions)
    ? item.transitions.filter((transition) => steps.some((step) => step.id === transition.sourceNodeId) && steps.some((step) => step.id === transition.targetNodeId))
    : defaultTransitions(steps);
  const existingFacts = (Array.isArray(item.processFacts) ? item.processFacts : []).map((fact) => ({
    ...fact, evidenceSource: fact.evidenceSource || "", evidencePeriod: fact.evidencePeriod || "",
    sampleSize: fact.sampleSize || "", evidenceStatus: fact.evidenceStatus || "待补证", attachmentName: fact.attachmentName || "",
    problemCategory: String(fact.problemCategory) === "规则类" ? "管理规则类" as const : fact.problemCategory || "流程类", problemTag: fact.problemTag || "",
    processLocationType: fact.processLocationType || (fact.anchorType === "EDGE" ? "流程交接" as const : fact.anchorType === "NODE" ? "节点流程" as const : "全流程" as const),
    locationText: fact.locationText || fact.anchorLabel || "", relatedObject: fact.relatedObject || "",
    sourceType: fact.sourceType || "MANUAL", sourceFile: fact.sourceFile || "", sourceLocation: fact.sourceLocation || "", sourceQuote: fact.sourceQuote || "",
  }));
  const migratedFacts = steps.filter((step) => step.anomaly?.trim() && !existingFacts.some((fact) => fact.migratedFromStepId === step.id)).map((step) => ({
    id: `fact_legacy_${step.id}`, anchorType: "NODE" as const, anchorId: step.id, anchorLabel: step.name,
    description: step.anomaly.trim(), frequency: "", impact: "", evidenceType: "历史步骤记录", evidenceNote: "", evidenceSource: "历史步骤记录", evidencePeriod: "", sampleSize: "", evidenceStatus: "待补证" as const, attachmentName: "", problemCategory: "流程类" as const, problemTag: "历史异常", processLocationType: "节点流程" as const, locationText: step.name, relatedObject: "", sourceType: "MANUAL" as const, sourceFile: "", sourceLocation: "", sourceQuote: "", migratedFromStepId: step.id,
  }));
  const toBeProcess = item.toBeProcess ? {
    ...item.toBeProcess,
    steps: item.toBeProcess.steps.map((step, index) => ({ ...emptyStep(index + 1), ...step, order: index + 1 })),
    transitions: Array.isArray(item.toBeProcess.transitions) ? item.toBeProcess.transitions : [],
    changes: Array.isArray(item.toBeProcess.changes) ? item.toBeProcess.changes : [],
    source: item.toBeProcess.source || "COPY", reviewed: Boolean(item.toBeProcess.reviewed), userEdited: Boolean(item.toBeProcess.userEdited),
  } : null;
  const version = Number.isInteger(item.version) && item.version > 0 ? item.version : 1;
  return {
    ...item, steps, transitions, processFacts: [...existingFacts, ...migratedFacts], toBeProcess, version,
    asIsDrawio: item.asIsDrawio ? { ...item.asIsDrawio, stage: "AS_IS", basedOnVersion: item.asIsDrawio.basedOnVersion || version, syncStatus: item.asIsDrawio.syncStatus || "DIRTY" } : null,
    toBeDrawio: item.toBeDrawio ? { ...item.toBeDrawio, stage: "TO_BE", basedOnVersion: item.toBeDrawio.basedOnVersion || version, syncStatus: item.toBeDrawio.syncStatus || "DIRTY" } : null,
    diagnosisStale: Boolean(item.diagnosisStale),
    findings: (Array.isArray(item.findings) ? item.findings : []).map((finding) => ({ ...finding, dimension: finding.dimension || ({ 责任: "组织", 交接: "端到端流程", 规则: "规则", 控制: "端到端流程", 数据: "IT", 异常闭环: "端到端流程" } as const)[finding.category] || "端到端流程", problemTag: finding.problemTag || finding.category || "" })),
  };
}

export function syncAutoTransitions(item: QccCase): QccCase {
  const explicit = item.transitions.filter((transition) => {
    const source = item.steps.find((step) => step.id === transition.sourceNodeId);
    return source?.routingMode !== "AUTO_NEXT" || source.nodeType === "DECISION";
  });
  const automatic = item.steps.slice(0, -1).filter((step) => (step.nodeType === "ACTION" || step.nodeType === "START") && step.routingMode === "AUTO_NEXT").map((step) => {
    const index = item.steps.findIndex((candidate) => candidate.id === step.id);
    const existing = item.transitions.find((transition) => transition.sourceNodeId === step.id && transition.transitionType === "DEFAULT");
    return { id: existing?.id || makeId("transition"), sourceNodeId: step.id, targetNodeId: item.steps[index + 1].id, transitionType: "DEFAULT" as const, branchName: "", conditionExpression: "", isDefault: true, order: 1 };
  });
  return { ...item, transitions: [...explicit, ...automatic] };
}

export function processIssues(item: QccCase): string[] {
  const issues: string[] = [];
  const ids = new Set(item.steps.map((step) => step.id));
  const starts = item.steps.filter((step) => step.nodeType === "START");
  if (starts.length !== 1) issues.push(starts.length ? "流程只能有一个开始节点" : "流程需要一个开始节点");
  if (!item.steps.some((step) => step.nodeType === "END")) issues.push("流程至少需要一个结束节点");
  for (const step of item.steps) {
    const outgoing = item.transitions.filter((transition) => transition.sourceNodeId === step.id);
    if (step.nodeType === "END" && outgoing.length) issues.push(`${step.name || `步骤${step.order}`}是结束节点，不能配置后续流转`);
    if ((step.nodeType === "ACTION" || step.nodeType === "START") && outgoing.length !== 1) issues.push(`${step.name || `步骤${step.order}`}需要配置一个后续步骤`);
    if (step.nodeType === "DECISION") {
      if (outgoing.length < 2 || outgoing.length > 6) issues.push(`${step.name || `步骤${step.order}`}需要配置2–6个判断分支`);
      const names = outgoing.map((transition) => transition.branchName.trim());
      if (names.some((name) => !name)) issues.push(`${step.name || `步骤${step.order}`}存在未命名分支`);
      if (outgoing.some((transition) => !transition.conditionExpression.trim())) issues.push(`${step.name || `步骤${step.order}`}存在未填写判断条件的分支`);
      if (new Set(names).size !== names.length) issues.push(`${step.name || `步骤${step.order}`}的分支名称不能重复`);
    }
    for (const transition of outgoing) {
      if (!ids.has(transition.targetNodeId)) issues.push(`${step.name || `步骤${step.order}`}存在无效目标步骤`);
      if (transition.targetNodeId === step.id) issues.push(`${step.name || `步骤${step.order}`}不能流转到自身`);
    }
  }
  const reachable = new Set<string>(); const queue = starts[0] ? [starts[0].id] : item.steps[0] ? [item.steps[0].id] : [];
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
    steps: [{ ...emptyStep(1), name: "流程开始", nodeType: "START", routingMode: "AUTO_NEXT" }, ...Array.from({ length: 4 }, (_, index) => emptyStep(index + 2)), emptyEndStep(6)], transitions: [], processFacts: [], toBeProcess: null,
    asIsDrawio: null, toBeDrawio: null, diagnosisStale: false, findings: [], hypotheses: [], countermeasures: [],
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
  const completeSteps = item.steps.filter((step) => (step.nodeType === "ACTION" || step.nodeType === "DECISION") && step.name.trim() && step.activity.trim());
  if (!completeSteps.length) issues.push("请至少填写1个有效活动或判断步骤");
  item.steps.filter((step) => step.nodeType === "ACTION" || step.nodeType === "DECISION").forEach((step) => {
    const missing = [["责任岗位", step.owner], ["输入", step.input], ["实际活动", step.activity], ["输出", step.output], ["标准/时限", step.standard]].filter(([, value]) => !value.trim()).map(([label]) => label);
    if (missing.length) issues.push(`${step.name || `步骤${step.order}`}缺少${missing.join("、")}`);
  });
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
