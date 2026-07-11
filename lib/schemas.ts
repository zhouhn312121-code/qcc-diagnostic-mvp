import { z } from "zod";

export const findingSchema = z.object({
  stepId: z.string(), stepName: z.string(), category: z.enum(["责任", "交接", "规则", "控制", "数据", "异常闭环"]),
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

const processStepSchema = z.object({
  id: z.string().min(1), order: z.number().int().positive(), name: z.string(), owner: z.string(), input: z.string(), activity: z.string(), output: z.string(), standard: z.string(), anomaly: z.string(),
  nodeType: z.enum(["ACTION", "DECISION", "END"]), routingMode: z.enum(["AUTO_NEXT", "SPECIFIED"]), decisionTitle: z.string(), decisionBasis: z.string(),
});
const transitionSchema = z.object({
  id: z.string().min(1), sourceNodeId: z.string().min(1), targetNodeId: z.string().min(1), transitionType: z.enum(["DEFAULT", "CONDITION"]), branchName: z.string(), conditionExpression: z.string(), isDefault: z.boolean(), order: z.number().int().positive(),
});

export const qccCaseSaveSchema = z.object({
  id: z.string().min(1), title: z.string(), problemType: z.enum(["质量", "交付", "库存", "效率", "成本", "协同"]), object: z.string(), location: z.string(), period: z.string(), frequency: z.string(), impact: z.string(), metric: z.string(), baseline: z.string(), target: z.string(), dataDefinition: z.string(), processStart: z.string(), processEnd: z.string(), processOwner: z.string(), sanitizedConfirmed: z.boolean(),
  steps: z.array(processStepSchema).min(1).max(20), transitions: z.array(transitionSchema), findings: z.array(z.record(z.unknown())), hypotheses: z.array(z.record(z.unknown())), countermeasures: z.array(z.record(z.unknown())), stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), status: z.enum(["草稿", "待诊断", "验证中", "方案设计", "已完成"]), engine: z.enum(["规则引擎", "AI模型", "AI失败后规则引擎"]).optional(), diagnosisModel: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), version: z.number().int().positive(),
}).passthrough();
