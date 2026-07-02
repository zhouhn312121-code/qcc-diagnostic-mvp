import { NextResponse } from "next/server";
import { caseCount, listCases, saveCase } from "@/lib/db";
import { createEmptyCase } from "@/lib/case-utils";
import { sampleCases } from "@/lib/samples";
import type { QccCase } from "@/lib/types";

function ensureSamples() {
  if (caseCount() === 0) sampleCases().forEach(saveCase);
}

export async function GET() {
  ensureSamples();
  return NextResponse.json({ cases: listCases() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Partial<QccCase> | null;
  const item = { ...createEmptyCase(), ...(body || {}) } as QccCase;
  return NextResponse.json({ case: saveCase(item) }, { status: 201 });
}
