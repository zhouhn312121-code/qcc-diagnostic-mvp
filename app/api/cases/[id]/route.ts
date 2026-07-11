import { NextResponse } from "next/server";
import { deleteCase, getCase, saveCaseVersioned } from "@/lib/db";
import { qccCaseSaveSchema } from "@/lib/schemas";
import type { QccCase } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  const { id } = await params;
  const item = getCase(id);
  return item ? NextResponse.json({ case: item }) : NextResponse.json({ error: "课题不存在" }, { status: 404 });
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  const current = getCase(id);
  if (!current) return NextResponse.json({ error: "课题不存在" }, { status: 404 });
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "保存内容不是有效JSON", code: "INVALID_JSON" }, { status: 400 }); }
  const parsed = qccCaseSaveSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "课题数据不完整", code: "VALIDATION_ERROR", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data as unknown as QccCase;
  if (body.id !== id) return NextResponse.json({ error: "课题ID不一致" }, { status: 400 });
  const saved = saveCaseVersioned(body, body.version);
  if (!saved) return NextResponse.json({ error: "课题已在其他页面更新，请保留当前内容并刷新后重试", code: "VERSION_CONFLICT", case: getCase(id) }, { status: 409 });
  return NextResponse.json({ case: saved });
}

export async function DELETE(_: Request, { params }: Context) {
  const { id } = await params;
  if (!deleteCase(id)) return NextResponse.json({ error: "课题不存在", code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, deletedId: id });
}
