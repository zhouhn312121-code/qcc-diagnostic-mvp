import { NextResponse } from "next/server";
import { parseMaterial } from "@/lib/materials";
import { aiConfigured, extractMaterialProblemsWithAi, resolveModel } from "@/lib/ai";
import { getCase } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择需要解读的文件" }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "文件不能超过10MB" }, { status: 413 });
    const result = await parseMaterial(file.name, Buffer.from(await file.arrayBuffer()));
    const caseId = String(form.get("caseId") || "");
    const item = caseId ? getCase(caseId) : null;
    const model = resolveModel(item?.diagnosisModel);
    if (model !== "rules" && aiConfigured(model)) {
      try {
        const candidates = await extractMaterialProblemsWithAi(result.segments, model);
        return NextResponse.json({ ...result, candidates, engine: "AI模型", model });
      } catch {
        return NextResponse.json({ ...result, engine: "AI失败后智能规则提取", model });
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "文件解读失败" }, { status: 422 });
  }
}
