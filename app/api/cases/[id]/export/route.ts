import ExcelJS from "exceljs";
import { getCase } from "@/lib/db";

const navy = "23285B";
const blue = "087EB7";
const pale = "F3F7FB";
const yellow = "FFF4CE";

function setupSheet(sheet: ExcelJS.Worksheet, title: string, columns: Array<{ header: string; key: string; width: number }>) {
  sheet.mergeCells(1, 1, 1, columns.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${navy}` } };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;
  sheet.addRow([]);
  sheet.columns = columns;
  const header = sheet.getRow(3);
  columns.forEach((column, index) => { header.getCell(index + 1).value = column.header; });
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${blue}` } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 28;
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.properties.defaultRowHeight = 22;
}

function finishSheet(sheet: ExcelJS.Worksheet) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE1E6EE" } } };
    });
  });
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: sheet.columnCount } };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getCase(id);
  if (!item) return Response.json({ error: "课题不存在" }, { status: 404 });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QCC流程破题诊断器";
  workbook.created = new Date();

  const overview = workbook.addWorksheet("诊断报告");
  setupSheet(overview, "流程问题诊断报告", [
    { header: "项目", key: "key", width: 24 }, { header: "内容", key: "value", width: 90 },
  ]);
  [
    ["课题名称", item.title], ["问题类型", item.problemType], ["问题事实", `${item.object}在${item.location}，${item.period}发生${item.frequency}；影响：${item.impact}`],
    ["核心指标", `${item.metric}：基线${item.baseline}，目标${item.target}`], ["统计口径", item.dataDefinition],
    ["流程边界", `${item.processStart} → ${item.processEnd}`], ["流程责任人", item.processOwner], ["诊断引擎", item.engine || "尚未诊断"],
    ["诊断结论", `识别${item.findings.length}个流程断点；${item.hypotheses.filter((h) => h.status === "证据支持").length}个原因获得证据支持；形成${item.countermeasures.length}项候选方案。`],
  ].forEach(([key, value]) => overview.addRow({ key, value }));
  overview.getColumn(1).eachCell((cell, row) => { if (row > 3) { cell.font = { bold: true, color: { argb: `FF${navy}` } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${pale}` } }; } });
  finishSheet(overview);

  const process = workbook.addWorksheet("AS IS流程");
  setupSheet(process, "AS IS关键流程与流转关系", [
    { header: "序号", key: "order", width: 8 }, { header: "节点类型", key: "type", width: 12 }, { header: "步骤", key: "name", width: 24 },
    { header: "主责", key: "owner", width: 18 }, { header: "输入", key: "input", width: 24 }, { header: "实际活动", key: "activity", width: 35 },
    { header: "输出", key: "output", width: 24 }, { header: "标准/时限", key: "standard", width: 24 }, { header: "异常事实", key: "anomaly", width: 32 }, { header: "流转关系", key: "routing", width: 45 },
  ]);
  item.steps.forEach((step) => {
    const routing = item.transitions.filter((transition) => transition.sourceNodeId === step.id).sort((a, b) => a.order - b.order).map((transition) => {
      const target = item.steps.find((candidate) => candidate.id === transition.targetNodeId)?.name || "未知目标";
      return transition.transitionType === "CONDITION" ? `${transition.branchName}（${transition.conditionExpression || "未填写条件"}）→ ${target}` : `→ ${target}`;
    }).join("；");
    process.addRow({ order: step.order, type: step.nodeType === "ACTION" ? "普通步骤" : step.nodeType === "DECISION" ? "判断节点" : "结束节点", name: step.name, owner: step.owner, input: step.input, activity: step.activity, output: step.output, standard: step.standard, anomaly: step.anomaly, routing });
  });
  finishSheet(process);

  const findings = workbook.addWorksheet("流程断点清单");
  setupSheet(findings, "流程断点清单", [
    { header: "流程步骤", key: "step", width: 20 }, { header: "断点类型", key: "category", width: 12 }, { header: "诊断结论", key: "title", width: 26 },
    { header: "判断依据", key: "evidence", width: 55 }, { header: "影响指标", key: "metric", width: 20 }, { header: "信息完整度", key: "completeness", width: 14 },
    { header: "优先级", key: "priority", width: 10 }, { header: "待确认问题", key: "question", width: 42 },
  ]);
  item.findings.forEach((f) => findings.addRow({ step: f.stepName, category: f.category, title: f.title, evidence: f.evidence, metric: f.impactMetric, completeness: `${f.completeness}%`, priority: f.priority, question: f.question }));
  finishSheet(findings);

  const causes = workbook.addWorksheet("原因假设与验证");
  setupSheet(causes, "原因假设与真因验证表", [
    { header: "流程步骤", key: "step", width: 18 }, { header: "原因类型", key: "kind", width: 12 }, { header: "原因假设", key: "statement", width: 40 },
    { header: "提出依据", key: "rationale", width: 42 }, { header: "验证方法", key: "method", width: 14 }, { header: "所需数据/样本", key: "data", width: 36 },
    { header: "判断标准", key: "rule", width: 45 }, { header: "责任人", key: "owner", width: 16 }, { header: "完成日期", key: "due", width: 14 },
    { header: "验证结果", key: "result", width: 40 }, { header: "证据结论", key: "status", width: 14 },
  ]);
  item.hypotheses.forEach((h) => causes.addRow({ step: h.stepName, kind: h.kind, statement: h.statement, rationale: h.rationale, method: h.verificationMethod, data: h.dataNeeded, rule: h.decisionRule, owner: h.owner, due: h.dueDate, result: h.result, status: h.status }));
  causes.getColumn(10).eachCell((cell, row) => { if (row > 3) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${yellow}` } }; });
  finishSheet(causes);

  const measures = workbook.addWorksheet("对策试行计划");
  setupSheet(measures, "对策试行与实施计划", [
    { header: "证据支持原因", key: "cause", width: 42 }, { header: "方案类型", key: "type", width: 14 }, { header: "实施动作", key: "action", width: 45 },
    { header: "试点范围", key: "scope", width: 30 }, { header: "责任角色", key: "owner", width: 20 }, { header: "成功指标", key: "metric", width: 32 },
    { header: "周期", key: "cycle", width: 10 }, { header: "风险", key: "risk", width: 28 }, { header: "回退方案", key: "rollback", width: 34 }, { header: "优先级分", key: "score", width: 12 },
  ]);
  item.countermeasures.sort((a, b) => b.totalScore - a.totalScore).forEach((m) => measures.addRow({ cause: m.cause, type: m.type, action: m.action, scope: m.pilotScope, owner: m.ownerRole, metric: m.successMetric, cycle: m.cycle, risk: m.risk, rollback: m.rollback, score: m.totalScore }));
  finishSheet(measures);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent(`${item.title}_QCC诊断包.xlsx`);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${filename}` },
  });
}
