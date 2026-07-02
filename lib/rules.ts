import { makeId } from "./ids";
import type { CauseHypothesis, Countermeasure, FindingCategory, ProcessFinding, ProcessStep, QccCase } from "./types";

const categoryAdvice: Record<FindingCategory, { title: string; question: string; method: CauseHypothesis["verificationMethod"] }> = {
  责任: { title: "责任与决策边界不清", question: "该步骤谁对结果负责，谁有权处理异常和调整优先级？", method: "文件追溯" },
  交接: { title: "输入输出或交付标准不完整", question: "上下游对交付物、时点和验收标准是否达成一致？", method: "现场观察" },
  规则: { title: "作业规则或例外规则不明确", question: "正常、加急和异常场景分别依据什么规则执行？", method: "文件追溯" },
  控制: { title: "关键控制与防错不足", question: "问题在进入下一步骤前，哪一个控制点本应发现或阻断？", method: "对比试验" },
  数据: { title: "过程数据不足以支持及时判断", question: "哪个指标可以更早反映偏差，数据由谁、何时记录？", method: "数据对比" },
  异常闭环: { title: "异常升级和复盘机制不完整", question: "异常由谁接收、何时升级、处理结果如何反馈并避免重复？", method: "现场观察" },
};

function completeness(step: ProcessStep): number {
  const fields = [step.owner, step.input, step.activity, step.output, step.standard, step.anomaly];
  return Math.round((fields.filter((value) => value.trim()).length / fields.length) * 100);
}

function candidateCategories(step: ProcessStep): FindingCategory[] {
  const categories: FindingCategory[] = [];
  if (!step.owner.trim()) categories.push("责任");
  if (!step.input.trim() || !step.output.trim()) categories.push("交接");
  if (!step.standard.trim()) categories.push("规则");
  const text = `${step.standard} ${step.anomaly} ${step.activity}`;
  if (!/检查|校验|防错|确认|审核|监控/.test(text)) categories.push("控制");
  if (!/数据|记录|指标|系统|看板|台账/.test(text)) categories.push("数据");
  if (!/异常|升级|反馈|复盘|关闭|闭环/.test(step.anomaly)) categories.push("异常闭环");
  return categories.slice(0, 3);
}

export function diagnoseWithRules(item: QccCase): { findings: ProcessFinding[]; hypotheses: CauseHypothesis[] } {
  const findings: ProcessFinding[] = [];
  for (const step of item.steps.filter((value) => value.name.trim() && value.activity.trim())) {
    for (const category of candidateCategories(step)) {
      const advice = categoryAdvice[category];
      const missing = category === "责任" ? "未填写主责角色" : category === "交接" ? "输入或输出信息缺失" : category === "规则" ? "未说明执行标准" : `现有描述未体现${category}机制`;
      findings.push({
        id: makeId("finding"), stepId: step.id, stepName: step.name, category, title: advice.title,
        evidence: `步骤“${step.name}”的现有描述为“${step.activity}”；${missing}。异常事实：${step.anomaly || "尚未补充"}。`,
        impactMetric: item.metric || "待补充核心指标", completeness: completeness(step), question: advice.question,
        priority: category === "控制" || category === "交接" ? "高" : category === "责任" || category === "异常闭环" ? "中" : "低",
      });
    }
  }
  const priorityRank = { 高: 3, 中: 2, 低: 1 };
  const selected = findings.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]).slice(0, 12);
  // Keep the verification workload small enough for a circle leader to act on:
  // the full finding list remains visible, but only the six highest-priority findings enter the first verification round.
  const hypotheses: CauseHypothesis[] = selected.slice(0, 6).flatMap((finding) => {
    const advice = categoryAdvice[finding.category];
    const common = {
      findingId: finding.id, stepName: finding.stepName, verificationMethod: advice.method,
      owner: item.processOwner || "流程责任人", dueDate: "", result: "", status: "待验证" as const,
    };
    return [
      {
        id: makeId("cause"), ...common, kind: "直接原因" as const,
        statement: `${finding.stepName}环节的${finding.category}缺口直接造成过程偏差未被及时识别或阻断`,
        rationale: `该假设来自断点“${finding.title}”，目前只有流程描述依据，仍需现场证据。`,
        dataNeeded: `收集${finding.stepName}环节至少20次执行记录，区分正常与异常样本`,
        decisionRule: `若存在该缺口的样本中${item.metric || "问题指标"}显著高于无缺口样本，则证据支持；否则不支持。`,
      },
      {
        id: makeId("cause"), ...common, kind: "机制原因" as const,
        statement: `流程未建立稳定的${finding.category}设计与持续检查机制`,
        rationale: `若只修复单次异常而不修复机制，相同问题仍可能重复发生。`,
        dataNeeded: `追溯现行流程、SOP、岗位职责及近3个月异常关闭记录`,
        decisionRule: `若正式文件或实际执行中均不存在有效机制，且异常重复发生，则证据支持。`,
      },
    ];
  });
  return { findings: selected, hypotheses };
}

const measureTemplates: Record<Countermeasure["type"], (cause: CauseHypothesis, item: QccCase) => Omit<Countermeasure, "id" | "causeId" | "cause" | "type" | "totalScore">> = {
  快速改善: (cause, item) => ({ action: `在${cause.stepName}设置临时检查清单与异常提示，明确当班确认人`, pilotScope: `选择1个班组或1条产线连续试行2周`, ownerRole: cause.owner, successMetric: `${item.metric || "核心指标"}达到${item.target || "课题目标"}，且无新增风险`, cycle: "2周", risk: "可能增加一线操作负担", rollback: "若节拍受影响，恢复原方式并保留异常记录", impact: 4, effort: 2, speed: 5, riskScore: 2 }),
  流程机制: (cause, item) => ({ action: `修订${cause.stepName}的责任、交接标准、控制点和异常升级规则`, pilotScope: `在问题发生流程范围内试运行4周`, ownerRole: item.processOwner || cause.owner, successMetric: `${item.metric || "核心指标"}持续4周达到${item.target || "目标"}`, cycle: "4周", risk: "跨岗位规则理解不一致", rollback: "保留原流程版本，评审后决定回退或调整", impact: 5, effort: 3, speed: 3, riskScore: 2 }),
  数字化支持: (cause, item) => ({ action: `为${cause.stepName}增加结构化记录、超限提醒与关键字段自动校验`, pilotScope: `先使用轻量表单或现有系统配置验证，不进行系统重建`, ownerRole: "业务流程责任人/IT支持", successMetric: `关键数据完整率≥95%，异常发现提前且${item.metric || "核心指标"}改善`, cycle: "3–6周", risk: "字段设计不合理造成重复录入", rollback: "关闭提醒规则，保留人工记录作为备份", impact: 4, effort: 4, speed: 2, riskScore: 3 }),
};

export function solutionsWithRules(item: QccCase): Countermeasure[] {
  const supported = item.hypotheses.filter((cause) => cause.status === "证据支持");
  return supported.flatMap((cause) => (["快速改善", "流程机制", "数字化支持"] as const).map((type) => {
    const template = measureTemplates[type](cause, item);
    const totalScore = Number(((template.impact * 0.35 + (6 - template.effort) * 0.25 + template.speed * 0.25 + (6 - template.riskScore) * 0.15)).toFixed(2));
    return { id: makeId("measure"), causeId: cause.id, cause: cause.statement, type, ...template, totalScore };
  }));
}

export function mergePreservingEdits<T extends { id: string; userEdited?: boolean }>(existing: T[], generated: T[]): T[] {
  const edited = existing.filter((item) => item.userEdited);
  const keys = new Set(edited.map((item) => item.id));
  return [...edited, ...generated.filter((item) => !keys.has(item.id))];
}
