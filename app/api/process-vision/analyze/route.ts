import { NextResponse } from "next/server";

export async function POST() {
  const configured = Boolean(process.env.VISION_API_BASE_URL && process.env.VISION_API_KEY && process.env.VISION_MODEL);
  if (!configured) return NextResponse.json({ error: "尚未配置视觉识别服务" }, { status: 503 });
  return NextResponse.json({ error: "视觉模型适配器将在提供正式API协议后启用" }, { status: 501 });
}
