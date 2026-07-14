import { NextResponse } from "next/server";
import { aiConfigured, diagnoseWithAi, resolveModel } from "@/lib/ai";
import { getCase, recordAiRun, saveCase } from "@/lib/db";
import { readinessIssues } from "@/lib/case-utils";
import { diagnoseWithRules, mergePreservingEdits } from "@/lib/rules";

export async function POST(request: Request) {
  const { caseId } = await request.json() as { caseId: string };
  const item = getCase(caseId);
  if (!item) return NextResponse.json({ error: "课题不存在" }, { status: 404 });
  const issues = readinessIssues(item);
  if (issues.length) return NextResponse.json({ error: "信息不足，暂不能诊断", issues }, { status: 422 });

  let result;
  let engine: "AI模型" | "规则引擎" | "AI失败后规则引擎" = "规则引擎";
  const selectedModel = resolveModel(item.diagnosisModel);
  try {
    if (selectedModel !== "rules" && aiConfigured(selectedModel)) { result = await diagnoseWithAi(item, selectedModel); engine = "AI模型"; }
    else result = diagnoseWithRules(item);
  } catch {
    result = diagnoseWithRules(item); engine = "AI失败后规则引擎";
  }
  if (engine === "AI模型") {
    const factResult = diagnoseWithRules(item);
    const supplemental = factResult.findings.filter((finding) => finding.anchorType !== "NODE");
    const ids = new Set(supplemental.map((finding) => finding.id));
    result = { findings: [...result.findings, ...supplemental].slice(0, 24), hypotheses: [...result.hypotheses, ...factResult.hypotheses.filter((cause) => ids.has(cause.findingId))].slice(0, 12) };
  }
  const next = saveCase({
    ...item,
    findings: mergePreservingEdits(item.findings, result.findings),
    hypotheses: mergePreservingEdits(item.hypotheses, result.hypotheses),
    stage: 3, status: "验证中", engine, diagnosisStale: false,
  });
  recordAiRun({ caseId, action: "diagnose", engine, model: selectedModel === "rules" ? "built-in-rule-engine" : selectedModel, inputSummary: `${item.title}｜${item.steps.length}个流程步骤`, outputJson: JSON.stringify(result), createdAt: new Date().toISOString() });
  return NextResponse.json({ case: next, engine, model: selectedModel });
}
