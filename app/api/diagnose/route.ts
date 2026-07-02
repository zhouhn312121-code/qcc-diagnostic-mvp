import { NextResponse } from "next/server";
import { aiConfigured, configuredModel, diagnoseWithAi } from "@/lib/ai";
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
  try {
    if (aiConfigured()) { result = await diagnoseWithAi(item); engine = "AI模型"; }
    else result = diagnoseWithRules(item);
  } catch {
    result = diagnoseWithRules(item); engine = "AI失败后规则引擎";
  }
  const next = saveCase({
    ...item,
    findings: mergePreservingEdits(item.findings, result.findings),
    hypotheses: mergePreservingEdits(item.hypotheses, result.hypotheses),
    stage: 3, status: "验证中", engine,
  });
  recordAiRun({ caseId, action: "diagnose", engine, model: configuredModel, inputSummary: `${item.title}｜${item.steps.length}个流程步骤`, outputJson: JSON.stringify(result), createdAt: new Date().toISOString() });
  return NextResponse.json({ case: next, engine });
}
