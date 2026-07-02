import { NextResponse } from "next/server";
import { deleteCase, getCase, saveCase } from "@/lib/db";
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
  const body = await request.json() as QccCase;
  if (body.id !== id) return NextResponse.json({ error: "课题ID不一致" }, { status: 400 });
  return NextResponse.json({ case: saveCase(body) });
}

export async function DELETE(_: Request, { params }: Context) {
  const { id } = await params;
  deleteCase(id);
  return NextResponse.json({ ok: true });
}
