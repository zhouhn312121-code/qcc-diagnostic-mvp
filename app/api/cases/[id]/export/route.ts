import ExcelJS from "exceljs";
import { getCase } from "@/lib/db";
import { problemCategories, type ProcessStep, type ProcessTransition } from "@/lib/types";

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

function processPath(steps: ProcessStep[], transitions: ProcessTransition[]) {
  return steps.map((step) => {
    const targets = transitions.filter((transition) => transition.sourceNodeId === step.id).map((transition) => `${transition.branchName ? `${transition.branchName}：` : ""}${steps.find((target) => target.id === transition.targetNodeId)?.name || "?"}`);
    return targets.length ? `${step.name} → ${targets.join(" / ")}` : step.name;
  }).join("；");
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
  const supported = item.hypotheses.filter((cause) => cause.status === "证据支持");
  const counts = problemCategories.map((category) => `${category}${item.processFacts.filter((fact) => fact.problemCategory === category).length}项`).join("、");
  [
    ["课题名称", item.title],
    ["一、问题与流程", ""], ["指标与目标", `${item.metric}：基线${item.baseline}，目标${item.target}；统计口径：${item.dataDefinition}`], ["流程边界", `${item.processStart} → ${item.processEnd}；责任人：${item.processOwner}`], ["AS IS流程", processPath(item.steps, item.transitions)],
    ["二、现状诊断", ""], ["问题分类", `共${item.processFacts.length}项：${counts}`], ["主要问题", item.processFacts.slice(0, 5).map((fact) => fact.description).join("；") || "尚未记录"], ["现状诊断结论", item.findings.filter((finding) => finding.priority === "高").map((finding) => `${finding.dimension}：${finding.title}`).join("；") || "尚未完成诊断"],
    ["三、根因验证", ""], ["根因总结", `${item.hypotheses.length}项假设中${supported.length}项获得证据支持`], ["证据支持根因", supported.map((cause) => `${cause.statement}（证据：${cause.result}）`).join("；") || "尚无"],
    ["四、改善方案", ""], ["TO BE流程", item.toBeProcess ? processPath(item.toBeProcess.steps, item.toBeProcess.transitions) : "尚未设计"], ["流程变更", item.toBeProcess?.changes.map((change) => `[${change.changeType}]${change.description}`).join("；") || "尚无"], ["详细方案", item.countermeasures.map((measure) => `[${measure.type}]${measure.action}；试点：${measure.pilotScope}；责任：${measure.ownerRole}；指标：${measure.successMetric}`).join("\n") || "尚未生成"],
  ].forEach(([key, value]) => overview.addRow({ key, value }));
  overview.getColumn(1).eachCell((cell, row) => { if (row <= 3) return; const section = String(cell.value || "").match(/^[一二三四]、/); cell.font = { bold: true, color: { argb: section ? "FFFFFFFF" : `FF${navy}` } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${section ? blue : pale}` } }; if (section) overview.getRow(row).height = 28; });
  finishSheet(overview);

  const process = workbook.addWorksheet("AS IS流程");
  setupSheet(process, "AS IS关键流程与流转关系", [
    { header: "序号", key: "order", width: 8 }, { header: "节点类型", key: "type", width: 12 }, { header: "步骤", key: "name", width: 24 },
    { header: "主责", key: "owner", width: 18 }, { header: "输入", key: "input", width: 24 }, { header: "实际活动", key: "activity", width: 35 },
    { header: "输出", key: "output", width: 24 }, { header: "标准/时限", key: "standard", width: 24 }, { header: "流转关系", key: "routing", width: 45 },
  ]);
  item.steps.forEach((step) => {
    const routing = item.transitions.filter((transition) => transition.sourceNodeId === step.id).sort((a, b) => a.order - b.order).map((transition) => {
      const target = item.steps.find((candidate) => candidate.id === transition.targetNodeId)?.name || "未知目标";
      return transition.transitionType === "CONDITION" ? `${transition.branchName}（${transition.conditionExpression || "未填写条件"}）→ ${target}` : `→ ${target}`;
    }).join("；");
    process.addRow({ order: step.order, type: step.nodeType === "ACTION" ? "普通步骤" : step.nodeType === "DECISION" ? "判断节点" : step.nodeType === "START" ? "开始节点" : "结束节点", name: step.name, owner: step.owner, input: step.input, activity: step.activity, output: step.output, standard: step.standard, routing });
  });
  finishSheet(process);

  const facts = workbook.addWorksheet("流程问题分析");
  setupSheet(facts, "流程问题事实与材料来源", [
    { header: "问题类型", key: "category", width: 14 }, { header: "流程细分", key: "locationType", width: 14 }, { header: "关联位置/对象", key: "location", width: 28 }, { header: "问题标签", key: "tag", width: 22 }, { header: "事实描述", key: "description", width: 55 }, { header: "发生频次", key: "frequency", width: 18 }, { header: "影响", key: "impact", width: 28 }, { header: "证据类型", key: "evidence", width: 18 }, { header: "证据来源", key: "source", width: 24 }, { header: "材料位置", key: "sourceLocation", width: 24 }, { header: "统计期间", key: "period", width: 18 }, { header: "样本数量", key: "sample", width: 14 }, { header: "证据状态", key: "status", width: 14 }, { header: "证据说明", key: "note", width: 32 }, { header: "附件名", key: "attachment", width: 24 },
  ]);
  item.processFacts.forEach((fact) => facts.addRow({ category: fact.problemCategory, locationType: fact.problemCategory === "流程类" ? fact.processLocationType : "不适用", location: fact.problemCategory === "流程类" ? fact.locationText || fact.anchorLabel : fact.relatedObject || fact.anchorLabel, tag: fact.problemTag, description: fact.description, frequency: fact.frequency, impact: fact.impact, evidence: fact.evidenceType, source: fact.evidenceSource, sourceLocation: fact.sourceLocation, period: fact.evidencePeriod, sample: fact.sampleSize, status: fact.evidenceStatus, note: fact.evidenceNote, attachment: fact.attachmentName }));
  finishSheet(facts);

  if (item.toBeProcess) {
    const tobe = workbook.addWorksheet("TO BE流程");
    setupSheet(tobe, "TO BE未来流程与变更关系", [{ header: "序号", key: "order", width: 8 }, { header: "步骤", key: "name", width: 26 }, { header: "主责", key: "owner", width: 18 }, { header: "未来活动", key: "activity", width: 38 }, { header: "标准/时限", key: "standard", width: 24 }]);
    item.toBeProcess.steps.forEach((step) => tobe.addRow({ order: step.order, name: step.name, owner: step.owner, activity: step.activity, standard: step.standard })); finishSheet(tobe);
    const changes = workbook.addWorksheet("流程变更追溯");
    setupSheet(changes, "AS IS / TO BE变更与原因追溯", [{ header: "变更类型", key: "type", width: 14 }, { header: "变更说明", key: "description", width: 60 }, { header: "已验证原因数", key: "causes", width: 18 }, { header: "详细措施数", key: "measures", width: 18 }]);
    item.toBeProcess.changes.forEach((change) => changes.addRow({ type: change.changeType, description: change.description, causes: change.causeIds.length, measures: change.measureIds.length })); finishSheet(changes);
  }

  const findings = workbook.addWorksheet("四维现状诊断");
  setupSheet(findings, "组织、端到端流程、IT、规则四维现状诊断", [
    { header: "诊断维度", key: "dimension", width: 16 }, { header: "问题标签", key: "tag", width: 20 }, { header: "流程步骤", key: "step", width: 20 }, { header: "机制类型", key: "category", width: 12 }, { header: "诊断结论", key: "title", width: 26 },
    { header: "判断依据", key: "evidence", width: 55 }, { header: "影响指标", key: "metric", width: 20 }, { header: "信息完整度", key: "completeness", width: 14 },
    { header: "优先级", key: "priority", width: 10 }, { header: "待确认问题", key: "question", width: 42 },
  ]);
  item.findings.forEach((f) => findings.addRow({ dimension: f.dimension, tag: f.problemTag, step: f.stepName, category: f.category, title: f.title, evidence: f.evidence, metric: f.impactMetric, completeness: `${f.completeness}%`, priority: f.priority, question: f.question }));
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
