import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { analyzeProcessDiagram, qwenVisionConfigured } from "@/lib/qwen-vision";

export async function POST(request: Request) {
  if (!qwenVisionConfigured()) return NextResponse.json({ error: "尚未配置阿里云百炼视觉API Key" }, { status: 503 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择流程图文件" }, { status: 400 });
    const analysis = await analyzeProcessDiagram(file);
    return NextResponse.json(analysis);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "模型返回的流程结构不符合要求", details: error.flatten() }, { status: 502 });
    const message = error instanceof Error ? error.message : "流程图识别失败";
    const status = /只支持|不能超过|最多识别|请选择/.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
