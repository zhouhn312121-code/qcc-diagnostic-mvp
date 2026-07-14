import { NextResponse } from "next/server";
import { qwenVisionConfig, qwenVisionConfigured } from "@/lib/qwen-vision";

export async function GET() {
  const config = qwenVisionConfig();
  return NextResponse.json({
    configured: qwenVisionConfigured(), provider: config.provider, region: config.region, model: config.model,
    supports: ["PNG", "JPG", "WebP", "PDF（最多5页）"], maxFileMB: 10,
  });
}
