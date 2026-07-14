import { NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import { convertDrawio, type DrawioJson } from "@/lib/drawio";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { caseId?: string; stage?: "AS_IS" | "TO_BE"; diagram?: DrawioJson } | null;
  if (!body?.caseId || !body.stage || !body.diagram) return NextResponse.json({ error: "转换参数不完整" }, { status: 400 });
  const item = getCase(body.caseId);
  if (!item) return NextResponse.json({ error: "课题不存在" }, { status: 404 });
  if (body.stage === "TO_BE" && !item.toBeProcess) return NextResponse.json({ error: "请先创建TO BE流程" }, { status: 422 });
  return NextResponse.json({ conversion: convertDrawio(body.diagram, item, body.stage) });
}
