import { NextResponse } from "next/server";
import { aiConfigured, resolveModel, toBeWithAi } from "@/lib/ai";
import { getCase, recordAiRun, saveCase } from "@/lib/db";
import { toBeWithRules } from "@/lib/rules";

export async function POST(request: Request) {
  const { caseId, mode = "AI", replace = false } = await request.json() as { caseId: string; mode?: "AI" | "COPY"; replace?: boolean };
  const item = getCase(caseId);
  if (!item) return NextResponse.json({ error: "课题不存在" }, { status: 404 });
  const supported = item.hypotheses.filter((cause) => cause.status === "证据支持");
  if (!supported.length) return NextResponse.json({ error: "尚无证据支持的原因，不能设计TO BE流程。" }, { status: 422 });
  if (item.toBeProcess?.userEdited && !replace) return NextResponse.json({ error: "TO BE流程已有人工修改，如需重新生成请先确认覆盖。", code: "TOBE_EDITED" }, { status: 409 });
  const selectedModel = resolveModel(item.diagnosisModel);
  let engine: "AI模型" | "规则引擎" | "AI失败后规则引擎" = "规则引擎";
  let toBeProcess;
  try {
    if (mode === "AI" && selectedModel !== "rules" && aiConfigured(selectedModel)) { toBeProcess = await toBeWithAi(item, selectedModel); engine = "AI模型"; }
    else toBeProcess = toBeWithRules(item, mode === "COPY" ? "COPY" : "RULES");
  } catch { toBeProcess = toBeWithRules(item, "RULES"); engine = "AI失败后规则引擎"; }
  const next = saveCase({ ...item, toBeProcess, toBeDrawio: item.toBeDrawio ? { ...item.toBeDrawio, syncStatus: "STALE" } : null, stage: 4, status: "方案设计", engine });
  recordAiRun({ caseId, action: "tobe", engine, model: selectedModel === "rules" ? "built-in-rule-engine" : selectedModel, inputSummary: `${item.title}｜${supported.length}个证据支持原因`, outputJson: JSON.stringify(toBeProcess), createdAt: new Date().toISOString() });
  return NextResponse.json({ case: next, engine, model: selectedModel });
}
