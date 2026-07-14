import { describe, expect, it } from "vitest";
import { hasProcessLoop, normalizeCase, processIssues, readinessIssues, syncAutoTransitions } from "@/lib/case-utils";
import { createEmptyCase } from "@/lib/case-utils";
import { makeId } from "@/lib/ids";
import { diagnoseWithRules, mergePreservingEdits, solutionsWithRules, toBeWithRules } from "@/lib/rules";
import { sampleCases } from "@/lib/samples";
import { calculateProcessChanges, convertDrawio, processToDrawioXml, qccLaneMergeXml, validateConvertedProcess, type DrawioJson } from "@/lib/drawio";

describe("QCC diagnosis guardrails", () => {
  it("requires quantified and sanitized input before diagnosis", () => {
    const item = sampleCases()[0];
    item.baseline = "";
    item.sanitizedConfirmed = false;
    const issues = readinessIssues(item);
    expect(issues.some((value) => value.includes("基线"))).toBe(true);
    expect(issues.some((value) => value.includes("脱敏"))).toBe(true);
  });

  it("traces every finding to a real process step", () => {
    const item = sampleCases()[0];
    const result = diagnoseWithRules(item);
    const stepIds = new Set(item.steps.map((step) => step.id));
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((finding) => stepIds.has(finding.stepId) && finding.evidence.includes(finding.stepName))).toBe(true);
  });

  it("never marks generated hypotheses as verified", () => {
    const result = diagnoseWithRules(sampleCases()[1]);
    expect(result.hypotheses.every((cause) => cause.status === "待验证" && cause.result === "")).toBe(true);
  });

  it("generates no solution for unverified causes", () => {
    const item = sampleCases()[2];
    const result = diagnoseWithRules(item);
    item.hypotheses = result.hypotheses;
    expect(solutionsWithRules(item)).toHaveLength(0);
  });

  it("generates three solution types only for supported causes", () => {
    const item = sampleCases()[3];
    const result = diagnoseWithRules(item);
    item.hypotheses = result.hypotheses;
    item.hypotheses[0].status = "证据支持";
    item.hypotheses[0].result = "20个异常样本均缺少控制，正常样本中仅2/20缺少。";
    const measures = solutionsWithRules(item);
    expect(measures).toHaveLength(3);
    expect(new Set(measures.map((measure) => measure.type))).toEqual(new Set(["快速改善", "流程机制", "数字化支持"]));
    expect(measures.every((measure) => measure.causeId === item.hypotheses[0].id)).toBe(true);
  });

  it("preserves user-edited content during supplemental generation", () => {
    const item = sampleCases()[4];
    const result = diagnoseWithRules(item);
    const edited = { ...result.findings[0], title: "人工确认后的断点", userEdited: true };
    const merged = mergePreservingEdits([edited], diagnoseWithRules(item).findings);
    expect(merged.some((finding) => finding.title === "人工确认后的断点")).toBe(true);
  });

  it("normalizes legacy cases with stable node fields and default transitions", () => {
    const legacy = sampleCases()[0];
    const raw = { ...legacy, transitions: undefined, version: undefined, steps: legacy.steps.filter((step) => step.nodeType !== "END").map(({ nodeType: _, routingMode: __, decisionTitle: ___, decisionBasis: ____, ...step }) => step) };
    const normalized = normalizeCase(raw as unknown as typeof legacy);
    expect(normalized.version).toBe(1);
    expect(normalized.steps.at(-1)?.nodeType).toBe("END");
    expect(normalized.transitions).toHaveLength(normalized.steps.length - 1);
  });

  it("migrates legacy step anomalies to facts exactly once", () => {
    const legacy = sampleCases()[0];
    const first = normalizeCase({ ...legacy, processFacts: [] });
    const second = normalizeCase(first);
    expect(first.processFacts.length).toBeGreaterThan(0);
    expect(second.processFacts).toHaveLength(first.processFacts.length);
    expect(first.processFacts.every((fact) => fact.anchorType === "NODE" && Boolean(fact.migratedFromStepId))).toBe(true);
  });

  it("builds TO BE changes only from supported causes", () => {
    const item = sampleCases()[1]; const result = diagnoseWithRules(item); item.hypotheses = result.hypotheses;
    item.hypotheses[0].status = "证据支持"; item.hypotheses[0].result = "样本对比支持";
    const tobe = toBeWithRules(item);
    expect(tobe.steps).toHaveLength(item.steps.length);
    expect(tobe.changes).toHaveLength(1);
    expect(tobe.changes[0].causeIds).toEqual([item.hypotheses[0].id]);
  });

  it("updates automatic routing after reordering while preserving explicit routing", () => {
    const item = createEmptyCase();
    const explicitSource = item.steps[1]; const explicitTarget = item.steps[4];
    explicitSource.routingMode = "SPECIFIED";
    item.transitions = [{ id: makeId("transition"), sourceNodeId: explicitSource.id, targetNodeId: explicitTarget.id, transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1 }];
    [item.steps[2], item.steps[3]] = [item.steps[3], item.steps[2]];
    const synced = syncAutoTransitions(item);
    expect(synced.transitions.find((transition) => transition.sourceNodeId === explicitSource.id)?.targetNodeId).toBe(explicitTarget.id);
    expect(synced.transitions.find((transition) => transition.sourceNodeId === item.steps[0].id)?.targetNodeId).toBe(item.steps[1].id);
  });

  it("validates decision branches and detects allowed process loops", () => {
    const item = createEmptyCase(); const decision = item.steps[0]; decision.nodeType = "DECISION"; decision.routingMode = "SPECIFIED";
    item.transitions = [
      { id: makeId("transition"), sourceNodeId: decision.id, targetNodeId: item.steps[1].id, transitionType: "CONDITION", branchName: "是", conditionExpression: "", isDefault: false, order: 1 },
      { id: makeId("transition"), sourceNodeId: decision.id, targetNodeId: item.steps[1].id, transitionType: "CONDITION", branchName: "否", conditionExpression: "", isDefault: true, order: 2 },
      ...item.transitions.filter((transition) => transition.sourceNodeId !== decision.id),
    ];
    item.steps[1].routingMode = "SPECIFIED";
    item.transitions = item.transitions.filter((transition) => transition.sourceNodeId !== item.steps[1].id);
    item.transitions.push({ id: makeId("transition"), sourceNodeId: item.steps[1].id, targetNodeId: decision.id, transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1 });
    expect(processIssues(item).some((issue) => issue.includes("判断分支"))).toBe(false);
    expect(hasProcessLoop(item)).toBe(true);
  });

  it("converts only QCC draw.io nodes and ignores decorative shapes", () => {
    const item = createEmptyCase();
    const metadata = { qccOwner: "计划员", qccInput: "需求", qccActivity: "核对需求", qccOutput: "任务", qccStandard: "10分钟" };
    const diagram: DrawioJson = { pages: [{ cells: [
      { id: "s", type: "node", label: "流程开始", metadata: { qccType: "START", qccNodeId: "start" } },
      { id: "a", type: "node", label: "核对需求", metadata: { ...metadata, qccType: "ACTION", qccNodeId: "action" } },
      { id: "e", type: "node", label: "流程结束", metadata: { qccType: "END", qccNodeId: "end" } },
      { id: "note", type: "node", label: "仅作说明" },
      { id: "sa", type: "edge", source: "s", target: "a" }, { id: "ae", type: "edge", source: "a", target: "e" },
    ] }] };
    const result = convertDrawio(diagram, item, "AS_IS");
    expect(result.steps.map((step) => step.id)).toEqual(["start", "action", "end"]);
    expect(result.transitions).toHaveLength(2);
    expect(result.ignored.map((shape) => shape.label)).toEqual(["仅作说明"]);
    expect(result.errors).toHaveLength(0);
  });

  it("repairs duplicate draw.io node ids and reports incomplete decision branches", () => {
    const item = createEmptyCase();
    const fields = { qccOwner: "计划员", qccInput: "需求", qccActivity: "判断", qccOutput: "结论", qccStandard: "即时" };
    const diagram: DrawioJson = { pages: [{ cells: [
      { id: "s", type: "node", label: "开始", metadata: { qccType: "START", qccNodeId: "same" } },
      { id: "d", type: "node", label: "是否齐套", metadata: { ...fields, qccType: "DECISION", qccNodeId: "same" } },
      { id: "e", type: "node", label: "结束", metadata: { qccType: "END", qccNodeId: "end" } },
      { id: "sd", type: "edge", source: "s", target: "d" },
      { id: "de", type: "edge", source: "d", target: "e", label: "是", metadata: { qccBranchName: "是" } },
    ] }] };
    const result = convertDrawio(diagram, item, "AS_IS");
    expect(new Set(result.steps.map((step) => step.id)).size).toBe(3);
    expect(result.errors.some((error) => error.includes("至少需要两个判断分支"))).toBe(true);
  });

  it("requires every QCC business field before a converted process can apply", () => {
    const item = createEmptyCase();
    const errors = validateConvertedProcess(item.steps, item.transitions);
    expect(errors.some((error) => error.includes("责任岗位") && error.includes("标准/时限"))).toBe(true);
  });

  it("keeps TO BE changes traceable to supported causes", () => {
    const item = createEmptyCase();
    const changed = item.steps.map((step, index) => index === 1 ? { ...step, owner: "新责任岗位" } : step);
    const changes = calculateProcessChanges(item.steps, changed, ["cause_supported"], ["measure_1"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].causeIds).toEqual(["cause_supported"]);
    expect(changes[0].measureIds).toEqual(["measure_1"]);
  });

  it("reports facts that lose their draw.io node association", () => {
    const item = createEmptyCase();
    item.processFacts = [{ id: "fact_old", anchorType: "NODE", anchorId: item.steps[1].id, anchorLabel: item.steps[1].name, description: "旧节点异常", frequency: "", impact: "", evidenceType: "现场观察", evidenceNote: "", evidenceSource: "现场", evidencePeriod: "", sampleSize: "", evidenceStatus: "待补证", attachmentName: "" }];
    const diagram: DrawioJson = { pages: [{ cells: [
      { id: "s", type: "node", label: "开始", metadata: { qccType: "START", qccNodeId: "new_start" } },
      { id: "e", type: "node", label: "结束", metadata: { qccType: "END", qccNodeId: "new_end" } },
      { id: "se", type: "edge", source: "s", target: "e" },
    ] }] };
    expect(convertDrawio(diagram, item, "AS_IS").impact.orphanFactIds).toEqual(["fact_old"]);
  });

  it("normalizes draw.io fields without duplicating or changing legacy facts", () => {
    const item = sampleCases()[0];
    const normalized = normalizeCase({ ...item, asIsDrawio: undefined, toBeDrawio: undefined, diagnosisStale: undefined } as unknown as typeof item);
    expect(normalized.asIsDrawio).toBeNull();
    expect(normalized.toBeDrawio).toBeNull();
    expect(normalized.diagnosisStale).toBe(false);
    expect(normalizeCase(normalized).processFacts).toHaveLength(normalized.processFacts.length);
  });

  it("creates traceable findings for edge and global facts", () => {
    const item = sampleCases()[0];
    item.processFacts.push(
      { id: "fact_edge", anchorType: "EDGE", anchorId: item.transitions[0].id, anchorLabel: "交接", description: "交接等待超过2小时", frequency: "8/20", impact: "延期", evidenceType: "数据", evidenceNote: "", evidenceSource: "系统", evidencePeriod: "近1月", sampleSize: "20", evidenceStatus: "已确认", attachmentName: "" },
      { id: "fact_global", anchorType: "GLOBAL", anchorId: "global", anchorLabel: "全流程", description: "缺少统一超时升级", frequency: "持续", impact: "周期延长", evidenceType: "访谈", evidenceNote: "", evidenceSource: "流程负责人", evidencePeriod: "", sampleSize: "5", evidenceStatus: "已确认", attachmentName: "" },
    );
    const result = diagnoseWithRules(item);
    expect(result.findings.some((finding) => finding.anchorType === "EDGE" && finding.factIds?.includes("fact_edge") && finding.evidenceLevel === "事实支持")).toBe(true);
    expect(result.findings.some((finding) => finding.anchorType === "GLOBAL" && finding.factIds?.includes("fact_global") && finding.evidenceLevel === "事实支持")).toBe(true);
  });

  it("migrates legacy rule facts and process locations idempotently", () => {
    const item = sampleCases()[0];
    item.processFacts = [{ id: "legacy_rule", anchorType: "EDGE", anchorId: item.transitions[0].id, anchorLabel: "销售→计划", description: "缺少统一审批规则", frequency: "", impact: "", evidenceType: "文件", evidenceNote: "", evidenceSource: "制度", evidencePeriod: "", sampleSize: "", evidenceStatus: "已确认", attachmentName: "", problemCategory: "规则类" as never, problemTag: "规则" }];
    const normalized = normalizeCase(item);
    expect(normalized.processFacts[0].problemCategory).toBe("管理规则类");
    expect(normalized.processFacts[0].processLocationType).toBe("流程交接");
    expect(normalized.processFacts[0].locationText).toBe("销售→计划");
    expect(normalizeCase(normalized).processFacts).toEqual(normalized.processFacts);
  });

  it("diagnoses a free-text node location without a structured node id", () => {
    const item = sampleCases()[0];
    item.processFacts.push({ id: "free_node", anchorType: "NODE", anchorId: "global", anchorLabel: "订单评审节点", locationText: "订单评审节点", processLocationType: "节点流程", description: "评审平均等待两天", frequency: "8/30", impact: "交付延期", evidenceType: "数据", evidenceNote: "", evidenceSource: "订单记录", evidencePeriod: "近3月", sampleSize: "30", evidenceStatus: "已确认", attachmentName: "", problemCategory: "流程类", problemTag: "等待" });
    const result = diagnoseWithRules(item);
    expect(result.findings.some((finding) => finding.factIds?.includes("free_node") && finding.stepName === "订单评审节点" && finding.evidenceLevel === "事实支持")).toBe(true);
  });

  it("marks findings without linked facts as process-structure evidence", () => {
    const item = sampleCases()[0];
    item.processFacts = [];
    const result = diagnoseWithRules(item);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((finding) => finding.evidenceLevel === "仅流程结构")).toBe(true);
  });

  it("uses structural completeness instead of a fixed five-step diagnosis gate", () => {
    const item = createEmptyCase();
    item.title = "单步骤审批"; item.object = "申请"; item.location = "办公室"; item.period = "近1月"; item.frequency = "10次"; item.impact = "等待"; item.metric = "周期"; item.baseline = "2天"; item.dataDefinition = "提交到批准"; item.processStart = "提交"; item.processEnd = "批准"; item.sanitizedConfirmed = true;
    const action = { ...item.steps[1], name: "审批", owner: "主管", input: "申请", activity: "审核申请", output: "结论", standard: "1天" };
    item.steps = [item.steps[0], action, item.steps.at(-1)!];
    item.transitions = [{ id: "t1", sourceNodeId: item.steps[0].id, targetNodeId: action.id, transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1 }, { id: "t2", sourceNodeId: action.id, targetNodeId: item.steps[2].id, transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1 }];
    expect(readinessIssues(item)).toHaveLength(0);
  });

  it("generates traditional swimlane containers with child activities", () => {
    const item = sampleCases()[0];
    const xml = processToDrawioXml(item.steps, item.transitions);
    expect(xml).toContain("qccType=\"LANE\"");
    expect(xml).toMatch(/parent=\"qcc_lane_\d+\"/);
    const laneXml = qccLaneMergeXml(0);
    expect(laneXml).toContain("qccType=\"LANE\"");
    expect(laneXml).toMatch(/qccType=\"ACTION\"[\s\S]+parent=\"lane_/);
  });
});
