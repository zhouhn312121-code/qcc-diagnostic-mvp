import { z } from "zod";

export const findingSchema = z.object({
  stepId: z.string(), stepName: z.string(), category: z.enum(["责任", "交接", "规则", "控制", "数据", "异常闭环"]),
  dimension: z.enum(["组织", "端到端流程", "IT", "规则"]), problemTag: z.string(),
  title: z.string(), evidence: z.string(), impactMetric: z.string(), completeness: z.number().min(0).max(100),
  question: z.string(), priority: z.enum(["高", "中", "低"]),
});

export const hypothesisSchema = z.object({
  findingIndex: z.number().int().nonnegative(), stepName: z.string(), kind: z.enum(["直接原因", "机制原因"]),
  statement: z.string(), rationale: z.string(), verificationMethod: z.enum(["数据对比", "现场观察", "测量验证", "对比试验", "文件追溯"]),
  dataNeeded: z.string(), decisionRule: z.string(), owner: z.string(), dueDate: z.string(),
});

export const diagnosisSchema = z.object({ findings: z.array(findingSchema).min(1).max(24), hypotheses: z.array(hypothesisSchema).min(1).max(12) });

export const solutionSchema = z.object({
  causeId: z.string(), cause: z.string(), type: z.enum(["快速改善", "流程机制", "数字化支持"]), action: z.string(),
  pilotScope: z.string(), ownerRole: z.string(), successMetric: z.string(), cycle: z.string(), risk: z.string(), rollback: z.string(),
  impact: z.number().min(1).max(5), effort: z.number().min(1).max(5), speed: z.number().min(1).max(5), riskScore: z.number().min(1).max(5),
});

export const solutionsSchema = z.object({ countermeasures: z.array(solutionSchema).min(1).max(24) });

export const materialCandidatesSchema = z.object({ candidates: z.array(z.object({
  description: z.string().min(1), problemCategory: z.enum(["组织类", "流程类", "IT类", "管理规则类"]),
  problemTag: z.string(), sourceLocation: z.string(), sourceQuote: z.string(), confidence: z.number().min(0).max(1),
})).max(30) });

const processStepSchema = z.object({
  id: z.string().min(1), order: z.number().int().positive(), name: z.string(), owner: z.string(), input: z.string(), activity: z.string(), output: z.string(), standard: z.string(), anomaly: z.string(),
  nodeType: z.enum(["START", "ACTION", "DECISION", "END"]), routingMode: z.enum(["AUTO_NEXT", "SPECIFIED"]), decisionTitle: z.string(), decisionBasis: z.string(), positionX: z.number(), positionY: z.number(), lane: z.string(),
  participants: z.string().default(""), decisionRole: z.string().default(""), escalationRole: z.string().default(""), systemTools: z.string().default(""), dataSource: z.string().default(""), entryMethod: z.string().default(""), duplicateEntry: z.string().default(""), systemOutput: z.string().default(""), automationControl: z.string().default(""), offlineWork: z.string().default(""), normalRule: z.string().default(""), exceptionRule: z.string().default(""), escalationRule: z.string().default(""), closureRule: z.string().default(""), policyReference: z.string().default(""),
});
const transitionSchema = z.object({
  id: z.string().min(1), sourceNodeId: z.string().min(1), targetNodeId: z.string().min(1), transitionType: z.enum(["DEFAULT", "CONDITION"]), branchName: z.string(), conditionExpression: z.string(), isDefault: z.boolean(), order: z.number().int().positive(),
});
const processFactSchema = z.object({ id: z.string(), anchorType: z.enum(["NODE", "EDGE", "GLOBAL"]), anchorId: z.string(), anchorLabel: z.string(), description: z.string(), frequency: z.string(), impact: z.string(), evidenceType: z.string(), evidenceNote: z.string(), evidenceSource: z.string(), evidencePeriod: z.string(), sampleSize: z.string(), evidenceStatus: z.enum(["已确认", "待补证", "有争议"]), attachmentName: z.string(), problemCategory: z.enum(["组织类", "流程类", "IT类", "管理规则类", "规则类"]), problemTag: z.string(), processLocationType: z.enum(["流程交接", "节点流程", "全流程"]).default("全流程"), locationText: z.string().default(""), relatedObject: z.string().default(""), sourceType: z.enum(["MANUAL", "DOCUMENT"]), sourceFile: z.string(), sourceLocation: z.string(), sourceQuote: z.string(), migratedFromStepId: z.string().optional() });
const processChangeSchema = z.object({ id: z.string(), stepId: z.string(), changeType: z.enum(["新增", "删除", "调整", "数字化"]), description: z.string(), causeIds: z.array(z.string()), measureIds: z.array(z.string()) });
const toBeProcessSchema = z.object({ steps: z.array(processStepSchema).min(1).max(20), transitions: z.array(transitionSchema), changes: z.array(processChangeSchema), source: z.enum(["COPY", "AI", "RULES"]), reviewed: z.boolean(), userEdited: z.boolean() });
const drawioDraftSchema = z.object({ stage: z.enum(["AS_IS", "TO_BE"]), xml: z.string(), updatedAt: z.string(), basedOnVersion: z.number().int().positive(), syncStatus: z.enum(["SYNCED", "DIRTY", "STALE", "CONFIRMING"]) });
export const toBeGenerationSchema = z.object({ steps: z.array(processStepSchema).min(1).max(20), transitions: z.array(transitionSchema), changes: z.array(processChangeSchema) });

export const qccCaseSaveSchema = z.object({
  id: z.string().min(1), title: z.string(), problemType: z.enum(["质量", "交付", "库存", "效率", "成本", "协同"]), object: z.string(), location: z.string(), period: z.string(), frequency: z.string(), impact: z.string(), metric: z.string(), baseline: z.string(), target: z.string(), dataDefinition: z.string(), processStart: z.string(), processEnd: z.string(), processOwner: z.string(), sanitizedConfirmed: z.boolean(),
  steps: z.array(processStepSchema).min(1).max(20), transitions: z.array(transitionSchema), processFacts: z.array(processFactSchema), toBeProcess: toBeProcessSchema.nullable(), asIsDrawio: drawioDraftSchema.nullable(), toBeDrawio: drawioDraftSchema.nullable(), diagnosisStale: z.boolean(), findings: z.array(z.record(z.unknown())), hypotheses: z.array(z.record(z.unknown())), countermeasures: z.array(z.record(z.unknown())), stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), status: z.enum(["草稿", "待诊断", "验证中", "方案设计", "已完成"]), engine: z.enum(["规则引擎", "AI模型", "AI失败后规则引擎"]).optional(), diagnosisModel: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), version: z.number().int().positive(),
}).passthrough();
