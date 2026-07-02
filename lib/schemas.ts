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
