import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.VISION_API_BASE_URL && process.env.VISION_API_KEY && process.env.VISION_MODEL),
    model: process.env.VISION_MODEL || null,
  });
}
