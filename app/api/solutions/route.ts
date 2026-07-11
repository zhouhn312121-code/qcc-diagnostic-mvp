import { NextResponse } from "next/server";
import { aiConfigured, resolveModel, solutionsWithAi } from "@/lib/ai";
import { getCase, recordAiRun, saveCase } from "@/lib/db";
import { mergePreservingEdits, solutionsWithRules } from "@/lib/rules";

export async function POST(request: Request) {
  const { caseId } = await request.json() as { caseId: string };
  const item = getCase(caseId);
  if (!item) return NextResponse.json({ error: "课题不存在" }, { status: 404 });
  const supported = item.hypotheses.filter((cause) => cause.status === "证据支持");
  if (!supported.length) return NextResponse.json({ error: "尚无证据支持的原因。请先完成验证，系统不会为待验证原因生成方案。" }, { status: 422 });
  let measures;
  let engine: "AI模型" | "规则引擎" | "AI失败后规则引擎" = "规则引擎";
  const selectedModel = resolveModel(item.diagnosisModel);
  try {
    if (selectedModel !== "rules" && aiConfigured(selectedModel)) { measures = await solutionsWithAi(item, selectedModel); engine = "AI模型"; }
    else measures = solutionsWithRules(item);
  } catch {
    measures = solutionsWithRules(item); engine = "AI失败后规则引擎";
  }
  const next = saveCase({ ...item, countermeasures: mergePreservingEdits(item.countermeasures, measures), stage: 5, status: "已完成", engine });
  recordAiRun({ caseId, action: "solutions", engine, model: selectedModel === "rules" ? "built-in-rule-engine" : selectedModel, inputSummary: `${item.title}｜${supported.length}个证据支持原因`, outputJson: JSON.stringify(measures), createdAt: new Date().toISOString() });
  return NextResponse.json({ case: next, engine, model: selectedModel });
}
