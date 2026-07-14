import { makeId } from "./ids";
import type { CauseHypothesis, Countermeasure, DiagnosisDimension, FindingCategory, ProcessFinding, ProcessStep, QccCase, ToBeProcess } from "./types";

const categoryDimension: Record<FindingCategory, DiagnosisDimension> = { 责任: "组织", 交接: "端到端流程", 规则: "规则", 控制: "端到端流程", 数据: "IT", 异常闭环: "端到端流程" };

const categoryAdvice: Record<FindingCategory, { title: string; question: string; method: CauseHypothesis["verificationMethod"] }> = {
  责任: { title: "责任与决策边界不清", question: "该步骤谁对结果负责，谁有权处理异常和调整优先级？", method: "文件追溯" },
  交接: { title: "输入输出或交付标准不完整", question: "上下游对交付物、时点和验收标准是否达成一致？", method: "现场观察" },
  规则: { title: "作业规则或例外规则不明确", question: "正常、加急和异常场景分别依据什么规则执行？", method: "文件追溯" },
  控制: { title: "关键控制与防错不足", question: "问题在进入下一步骤前，哪一个控制点本应发现或阻断？", method: "对比试验" },
  数据: { title: "过程数据不足以支持及时判断", question: "哪个指标可以更早反映偏差，数据由谁、何时记录？", method: "数据对比" },
  异常闭环: { title: "异常升级和复盘机制不完整", question: "异常由谁接收、何时升级、处理结果如何反馈并避免重复？", method: "现场观察" },
};

function completeness(step: ProcessStep): number {
  const fields = [step.owner, step.input, step.activity, step.output, step.standard];
  return Math.round((fields.filter((value) => value.trim()).length / fields.length) * 100);
}

function candidateCategories(step: ProcessStep, factText: string): FindingCategory[] {
  const categories: FindingCategory[] = [];
  if (!step.owner.trim()) categories.push("责任");
  if (!step.input.trim() || !step.output.trim()) categories.push("交接");
  if (!step.standard.trim()) categories.push("规则");
  const text = `${step.standard} ${factText} ${step.activity}`;
  if (!/检查|校验|防错|确认|审核|监控/.test(text)) categories.push("控制");
  if (!/数据|记录|指标|系统|看板|台账/.test(text)) categories.push("数据");
  if (!/异常|升级|反馈|复盘|关闭|闭环/.test(factText)) categories.push("异常闭环");
  return categories.slice(0, 3);
}

function dimensionsForStep(step: ProcessStep, factText: string): Array<{ category: FindingCategory; dimension: DiagnosisDimension; tag: string; reason: string }> {
  const candidates: Array<{ category: FindingCategory; dimension: DiagnosisDimension; tag: string; reason: string }> = [];
  if (!step.owner.trim() || !step.participants?.trim() || !step.decisionRole?.trim()) candidates.push({ category: "责任", dimension: "组织", tag: "职责与决策", reason: "主责、参与角色或决策角色信息不完整" });
  if (!step.input.trim() || !step.output.trim()) candidates.push({ category: "交接", dimension: "端到端流程", tag: "输入输出", reason: "上下游输入输出信息不完整" });
  if (!/检查|校验|防错|确认|审核|监控/.test(`${step.activity} ${step.standard} ${factText}`)) candidates.push({ category: "控制", dimension: "端到端流程", tag: "过程控制", reason: "活动描述未体现检查、防错或过程控制" });
  if (!step.systemTools?.trim() || !step.dataSource?.trim() || !step.systemOutput?.trim()) candidates.push({ category: "数据", dimension: "IT", tag: "系统与数据", reason: "系统工具、数据来源或系统输出信息不完整" });
  if (/重复|手工|线下|Excel|表格/.test(`${step.duplicateEntry} ${step.offlineWork} ${factText}`)) candidates.push({ category: "数据", dimension: "IT", tag: "断点与重复录入", reason: "存在手工、线下或重复录入迹象" });
  if (!step.standard.trim() || !step.normalRule?.trim() || !step.exceptionRule?.trim()) candidates.push({ category: "规则", dimension: "规则", tag: "正常与例外规则", reason: "标准、正常规则或例外规则信息不完整" });
  if (!step.escalationRule?.trim() || !step.closureRule?.trim()) candidates.push({ category: "异常闭环", dimension: "规则", tag: "升级与关闭", reason: "异常升级或关闭规则信息不完整" });
  return candidates;
}

export function diagnoseWithRules(item: QccCase): { findings: ProcessFinding[]; hypotheses: CauseHypothesis[] } {
  const findings: ProcessFinding[] = [];
  for (const step of item.steps.filter((value) => value.name.trim() && value.activity.trim())) {
    const linkedFacts = item.processFacts.filter((fact) => fact.anchorType === "NODE" && fact.anchorId === step.id);
    const factText = linkedFacts.map((fact) => fact.description).join("；");
    const scan = dimensionsForStep(step, factText);
    for (const { category, dimension, tag, reason } of scan.length ? scan : candidateCategories(step, factText).map((category) => ({ category, dimension: categoryDimension[category], tag: category, reason: `现有描述未体现${category}机制` }))) {
      const advice = categoryAdvice[category];
      findings.push({
        id: makeId("finding"), stepId: step.id, stepName: step.name, category, dimension, problemTag: tag, title: advice.title,
        evidence: `步骤“${step.name}”的现有描述为“${step.activity}”；${reason}。流程问题事实：${factText || "尚未补充"}。`,
        impactMetric: item.metric || "待补充核心指标", completeness: completeness(step), question: advice.question,
        priority: category === "控制" || category === "交接" ? "高" : category === "责任" || category === "异常闭环" ? "中" : "低",
        anchorType: "NODE", anchorId: step.id, factIds: linkedFacts.map((fact) => fact.id),
        evidenceLevel: linkedFacts.length ? "结构与事实相互印证" : "仅流程结构",
      });
    }
  }
  for (const fact of item.processFacts.filter((value) => value.anchorType !== "NODE" || !item.steps.some((step) => step.id === value.anchorId))) {
    const transition = fact.anchorType === "EDGE" ? item.transitions.find((value) => value.id === fact.anchorId) : undefined;
    const source = transition ? item.steps.find((step) => step.id === transition.sourceNodeId) : undefined;
    const target = transition ? item.steps.find((step) => step.id === transition.targetNodeId) : undefined;
    const stepName = fact.locationText || fact.relatedObject || (fact.anchorType === "EDGE" ? `${source?.name || "?"} → ${target?.name || "?"}` : fact.anchorType === "NODE" ? fact.anchorLabel || "节点流程" : "全流程");
    const category: FindingCategory = fact.problemCategory === "组织类" ? "责任" : fact.problemCategory === "IT类" ? "数据" : fact.problemCategory === "管理规则类" ? "规则" : fact.anchorType === "EDGE" ? "交接" : "异常闭环";
    const dimension: DiagnosisDimension = fact.problemCategory === "组织类" ? "组织" : fact.problemCategory === "IT类" ? "IT" : fact.problemCategory === "管理规则类" ? "规则" : "端到端流程";
    const advice = categoryAdvice[category];
    findings.push({
      id: makeId("finding"), stepId: source?.id || "global", stepName, category, dimension, problemTag: fact.problemTag || (fact.anchorType === "EDGE" ? "跨环节交接" : "全流程问题"), title: fact.anchorType === "EDGE" ? "跨环节交接存在事实性断点" : `${dimension}维度存在事实性问题`,
      evidence: `异常事实“${fact.description}”${fact.frequency ? `；频次：${fact.frequency}` : ""}${fact.impact ? `；影响：${fact.impact}` : ""}。`,
      impactMetric: item.metric || "待补充核心指标", completeness: fact.evidenceStatus === "已确认" ? 100 : 80, question: advice.question,
      priority: "高", anchorType: fact.anchorType, anchorId: fact.anchorId, factIds: [fact.id],
      evidenceLevel: fact.evidenceStatus === "已确认" ? "事实支持" : "待补证",
    });
  }
  const priorityRank = { 高: 3, 中: 2, 低: 1 };
  const deduped = findings
    .filter((finding, index, values) => values.findIndex((candidate) => candidate.anchorType === finding.anchorType && candidate.anchorId === finding.anchorId && candidate.category === finding.category && candidate.title === finding.title) === index)
    .sort((a, b) => Number(Boolean(b.factIds?.length)) - Number(Boolean(a.factIds?.length)) || priorityRank[b.priority] - priorityRank[a.priority]);
  const factBacked = deduped.filter((finding) => Boolean(finding.factIds?.length));
  const balanced = (["组织", "端到端流程", "IT", "规则"] as const).flatMap((dimension) => deduped.filter((finding) => finding.dimension === dimension).slice(0, 4));
  const selected = [...factBacked, ...balanced].filter((finding, index, values) => values.findIndex((value) => value.id === finding.id) === index).slice(0, 24);
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

export function toBeWithRules(item: QccCase, source: ToBeProcess["source"] = "COPY"): ToBeProcess {
  const supported = item.hypotheses.filter((cause) => cause.status === "证据支持");
  const steps = item.steps.map((step) => ({ ...step, anomaly: "" }));
  const changes = supported.slice(0, 6).map((cause) => {
    const step = steps.find((candidate) => candidate.name === cause.stepName) || steps.find((candidate) => candidate.nodeType === "ACTION") || steps[0];
    return { id: makeId("change"), stepId: step.id, changeType: "调整" as const, description: `针对“${cause.statement}”，完善${step.name}的责任、标准、控制与异常闭环`, causeIds: [cause.id], measureIds: item.countermeasures.filter((measure) => measure.causeId === cause.id).map((measure) => measure.id) };
  });
  return { steps, transitions: item.transitions.map((transition) => ({ ...transition })), changes, source, reviewed: false, userEdited: false };
}

export function mergePreservingEdits<T extends { id: string; userEdited?: boolean }>(existing: T[], generated: T[]): T[] {
  const edited = existing.filter((item) => item.userEdited);
  const keys = new Set(edited.map((item) => item.id));
  return [...edited, ...generated.filter((item) => !keys.has(item.id))];
}
