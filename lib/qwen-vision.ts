import { visionProcessSchema, validateVisionProcess, type VisionProcessResult } from "./process-vision";

const defaultBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const maxImageBytes = 7 * 1024 * 1024;

export function qwenVisionConfigured() {
  return Boolean(process.env.VISION_API_KEY);
}

export function qwenVisionConfig() {
  return {
    provider: "阿里云百炼",
    region: "华北2（北京）",
    baseUrl: (process.env.VISION_API_BASE_URL || defaultBaseUrl).replace(/\/$/, ""),
    model: process.env.VISION_MODEL || "qwen3.7-plus",
  };
}

async function pdfToImages(buffer: ArrayBuffer): Promise<Array<{ mimeType: string; bytes: Uint8Array }>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  if (document.numPages > 5) throw new Error("PDF最多识别前5页，请拆分后重试");
  const images: Array<{ mimeType: string; bytes: Uint8Array }> = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.7 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
    const bytes = canvas.toBuffer("image/png");
    if (bytes.byteLength > maxImageBytes) throw new Error(`PDF第${pageNumber}页渲染后超过7MB，请降低页面尺寸或拆分文件`);
    images.push({ mimeType: "image/png", bytes });
  }
  return images;
}

async function fileToImages(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("文件不能超过10MB");
  const buffer = await file.arrayBuffer();
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return pdfToImages(buffer);
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) throw new Error("只支持PNG、JPG、WebP和PDF文件");
  if (file.size > maxImageBytes) throw new Error("图片不能超过7MB");
  return [{ mimeType: file.type, bytes: new Uint8Array(buffer) }];
}

function parseJsonContent(content: string) {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(normalized) as unknown;
}

export async function analyzeProcessDiagram(file: File): Promise<{ result: VisionProcessResult; validationIssues: string[]; usage?: unknown; requestId?: string }> {
  if (!qwenVisionConfigured()) throw new Error("尚未配置阿里云百炼视觉API Key");
  const { baseUrl, model } = qwenVisionConfig();
  const images = await fileToImages(file);
  const imageContent = images.map(({ mimeType, bytes }) => ({ type: "image_url", image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` }, min_pixels: 65536, max_pixels: 4194304 }));
  const prompt = `识别上传的AS IS业务流程图，并只输出一个JSON对象。不得猜测图中不存在的文字；不确定内容必须放入uncertainties。\n\nJSON结构：{"summary":"识别摘要","lanes":[{"id":"lane_1","name":"泳道名称","order":0,"confidence":0.9}],"nodes":[{"id":"node_1","name":"节点文字","nodeType":"START|ACTION|DECISION|END","owner":"责任岗位","lane":"泳道名称","input":"输入","activity":"实际活动","output":"输出","standard":"标准/时限","confidence":0.9}],"transitions":[{"id":"edge_1","sourceNodeId":"node_1","targetNodeId":"node_2","branchName":"是/否或空字符串","conditionExpression":"判断条件或空字符串","confidence":0.9}],"uncertainties":[{"id":"uncertain_1","kind":"NODE|EDGE|LANE|TEXT","targetId":"关联ID或空字符串","question":"需要人工确认的问题","suggestion":"模型建议","confidence":0.5}]}。\n\n要求：节点最多20个；识别真实箭头方向、判断分支、回流和跨泳道交接；普通文字说明不要生成节点；判断节点至少识别所有可见分支；无法确认责任、输入、输出、标准时保留空字符串。`;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VISION_API_KEY}` },
    body: JSON.stringify({ model, enable_thinking: false, temperature: 0, response_format: { type: "json_object" }, messages: [
      { role: "system", content: "你是严谨的流程图结构识别助手。输出必须是合法JSON，所有结论必须来自图片。" },
      { role: "user", content: [...imageContent, { type: "text", text: prompt }] },
    ] }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; message?: string; code?: string; usage?: unknown } | null;
  if (!response.ok) throw new Error(payload?.message || payload?.code || `视觉模型调用失败（${response.status}）`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("视觉模型没有返回识别结果");
  const result = visionProcessSchema.parse(parseJsonContent(content));
  return { result, validationIssues: validateVisionProcess(result), usage: payload?.usage, requestId: response.headers.get("x-request-id") || undefined };
}
