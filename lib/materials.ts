import ExcelJS from "exceljs";
import mammoth from "mammoth";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProblemCategory, ProcessFactAnchor } from "./types";

export interface MaterialSegment { location: string; text: string }
export interface MaterialCandidate {
  description: string; problemCategory: ProblemCategory; problemTag: string;
  anchorType: ProcessFactAnchor; sourceLocation: string; sourceQuote: string; confidence: number;
}

const MAX_TEXT = 100_000;

function clean(value: string) { return value.replace(/\s+/g, " ").trim(); }

export function extractProblemCandidates(segments: MaterialSegment[]): MaterialCandidate[] {
  return segments.flatMap((segment) => segment.text.split(/\n|。|；/).map(clean).filter((text) => text.length >= 8).map((text) => {
    const org = /组织|岗位|职责|责任|权限|人员|协调|决策/.test(text);
    const it = /系统|ERP|CRM|MES|Excel|数据|接口|重复录入|手工录入|权限|提醒|自动/.test(text);
    const rule = /规则|制度|标准|时限|SOP|审批|升级|关闭|例外|考核/.test(text);
    const problemCategory: ProblemCategory = org ? "组织类" : it ? "IT类" : rule ? "管理规则类" : "流程类";
    const problemTag = org ? "职责与协同" : it ? (/重复录入|手工录入|Excel/.test(text) ? "重复录入与线下作业" : "系统与数据") : rule ? (/升级|关闭|例外/.test(text) ? "例外与闭环规则" : "制度与标准") : (/交接|传递|反馈|等待/.test(text) ? "跨环节交接" : "流程效率与控制");
    return { description: text, problemCategory, problemTag, anchorType: "GLOBAL" as const, sourceLocation: segment.location, sourceQuote: text, confidence: org || it || rule ? 0.86 : 0.68 };
  })).filter((candidate, index, values) => values.findIndex((value) => value.description === candidate.description) === index).slice(0, 30);
}

async function parseDocx(buffer: Buffer): Promise<MaterialSegment[]> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.split(/\n+/).map((text: string) => clean(text)).filter(Boolean).map((text: string, index: number) => ({ location: `段落 ${index + 1}`, text }));
}

async function parseXlsx(buffer: Buffer): Promise<MaterialSegment[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const segments: MaterialSegment[] = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : Object.values(row.values || {});
    const text = clean(values.map((value) => typeof value === "object" && value && "text" in value ? String(value.text) : String(value ?? "")).join(" | "));
    if (text) segments.push({ location: `工作表“${sheet.name}”第${rowNumber}行`, text });
  }));
  return segments;
}

async function parsePdf(buffer: Buffer): Promise<MaterialSegment[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const segments: MaterialSegment[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = clean(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    if (text) segments.push({ location: `第${pageNumber}页`, text });
  }
  if (!segments.length) throw new Error("未读取到文字。该PDF可能是扫描件，首版仅支持文字型PDF。 ");
  return segments;
}

export async function parseMaterial(fileName: string, buffer: Buffer) {
  const extension = fileName.toLowerCase().split(".").pop();
  let segments: MaterialSegment[];
  if (extension === "docx") segments = await parseDocx(buffer);
  else if (extension === "xlsx") segments = await parseXlsx(buffer);
  else if (extension === "pdf") segments = await parsePdf(buffer);
  else throw new Error("仅支持DOCX、XLSX和PDF文件");
  let used = 0;
  segments = segments.filter((segment) => { used += segment.text.length; return used <= MAX_TEXT; });
  if (!segments.length) throw new Error("文件中没有可用于分析的文字内容");
  return { fileName, segments, candidates: extractProblemCandidates(segments), engine: "智能规则提取" as const };
}
