import { diagnosisSchema, solutionsSchema } from "./schemas";
import { makeId } from "./ids";
import type { CauseHypothesis, Countermeasure, ProcessFinding, QccCase } from "./types";

const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.AI_API_KEY;
const model = process.env.AI_MODEL;

export function aiConfigured() {
  return Boolean(baseUrl && apiKey && model);
}

async function chatJson(system: string, payload: unknown): Promise<unknown> {
  if (!baseUrl || !apiKey || !model) throw new Error("AI is not configured");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" },
      ...(baseUrl.includes("api.deepseek.com") ? { thinking: { type: "disabled" } } : {}), messages: [
      { role: "system", content: system }, { role: "user", content: JSON.stringify(payload) },
    ] }), signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned an empty response");
  return JSON.parse(content);
}

export async function diagnoseWithAi(item: QccCase): Promise<{ findings: ProcessFinding[]; hypotheses: CauseHypothesis[] }> {
  const raw = await chatJson(`你是一名严谨的QCC流程诊断辅导员。只依据用户提供的事实诊断责任、交接、规则、控制、数据、异常闭环六类断点。不得把假设写成真因。每个finding的evidence必须引用具体流程步骤或缺失信息。

只输出一个JSON对象，不得使用中文字段名，不得增加包装层。字段名、类型和枚举必须与下面完全一致，所有字段必填：
{
  "findings": [{
    "stepId": "必须原样使用输入流程步骤的id",
    "stepName": "必须原样使用对应流程步骤的name",
    "category": "责任|交接|规则|控制|数据|异常闭环",
    "title": "断点结论",
    "evidence": "引用具体步骤事实或明确缺失信息",
    "impactMetric": "受影响指标",
    "completeness": 0到100的数字,
    "question": "需要进一步确认的问题",
    "priority": "高|中|低"
  }],
  "hypotheses": [{
    "findingIndex": 关联findings数组的从0开始整数下标,
    "stepName": "对应流程步骤名称",
    "kind": "直接原因|机制原因",
    "statement": "待验证原因假设",
    "rationale": "提出依据",
    "verificationMethod": "数据对比|现场观察|测量验证|对比试验|文件追溯",
    "dataNeeded": "所需数据和样本",
    "decisionRule": "成立与不成立的判断标准",
    "owner": "建议责任角色",
    "dueDate": "建议完成日期或空字符串"
  }]
}
只为高优先级断点生成原因假设，hypotheses最多12项。`, {
    problem: { title: item.title, type: item.problemType, object: item.object, location: item.location, period: item.period, frequency: item.frequency, impact: item.impact, metric: item.metric, baseline: item.baseline, target: item.target, dataDefinition: item.dataDefinition },
    process: { start: item.processStart, end: item.processEnd, owner: item.processOwner, steps: item.steps },
  });
  const parsed = diagnosisSchema.parse(raw);
  const findings = parsed.findings.map((finding) => ({ ...finding, id: makeId("finding") }));
  const hypotheses = parsed.hypotheses.map((hypothesis) => ({
    id: makeId("cause"), findingId: findings[hypothesis.findingIndex]?.id || findings[0].id, stepName: hypothesis.stepName,
    kind: hypothesis.kind, statement: hypothesis.statement, rationale: hypothesis.rationale, verificationMethod: hypothesis.verificationMethod,
    dataNeeded: hypothesis.dataNeeded, decisionRule: hypothesis.decisionRule, owner: hypothesis.owner || item.processOwner,
    dueDate: hypothesis.dueDate, result: "", status: "待验证" as const,
  }));
  return { findings, hypotheses };
}

export async function solutionsWithAi(item: QccCase): Promise<Countermeasure[]> {
  const supported = item.hypotheses.filter((cause) => cause.status === "证据支持");
  const raw = await chatJson(`你是一名制造与供应链流程改善顾问。只能针对证据支持的原因生成方案，每个原因分别给快速改善、流程机制、数字化支持三类方案。数字化方案不得建议重大系统重建。

只输出一个JSON对象，不得使用中文字段名，不得增加包装层。字段名、类型和枚举必须与下面完全一致，所有字段必填：
{
  "countermeasures": [{
    "causeId": "必须原样使用输入中证据支持原因的id",
    "cause": "对应原因陈述",
    "type": "快速改善|流程机制|数字化支持",
    "action": "具体实施动作",
    "pilotScope": "试点范围",
    "ownerRole": "责任角色",
    "successMetric": "成功指标",
    "cycle": "实施周期",
    "risk": "主要风险",
    "rollback": "回退方案",
    "impact": 1到5的数字,
    "effort": 1到5的数字,
    "speed": 1到5的数字,
    "riskScore": 1到5的数字
  }]
}`, { case: item, supportedCauses: supported });
  const parsed = solutionsSchema.parse(raw);
  return parsed.countermeasures.map((measure) => ({
    ...measure, id: makeId("measure"),
    totalScore: Number(((measure.impact * 0.35 + (6 - measure.effort) * 0.25 + measure.speed * 0.25 + (6 - measure.riskScore) * 0.15)).toFixed(2)),
  }));
}

export const configuredModel = model || "built-in-rule-engine";
