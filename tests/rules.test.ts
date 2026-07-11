import { describe, expect, it } from "vitest";
import { hasProcessLoop, normalizeCase, processIssues, readinessIssues, syncAutoTransitions } from "@/lib/case-utils";
import { createEmptyCase } from "@/lib/case-utils";
import { makeId } from "@/lib/ids";
import { diagnoseWithRules, mergePreservingEdits, solutionsWithRules } from "@/lib/rules";
import { sampleCases } from "@/lib/samples";

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
});
