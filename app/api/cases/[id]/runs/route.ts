import { NextResponse } from "next/server";
import { listAiRuns } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ runs: listAiRuns(id) });
}
