export const problemTypes = ["质量", "交付", "库存", "效率", "成本", "协同"] as const;
export type ProblemType = (typeof problemTypes)[number];

export const findingCategories = ["责任", "交接", "规则", "控制", "数据", "异常闭环"] as const;
export type FindingCategory = (typeof findingCategories)[number];
export type EvidenceStatus = "待验证" | "证据支持" | "证据不支持" | "证据不足";
export type Priority = "高" | "中" | "低";
export type ProcessNodeType = "ACTION" | "DECISION" | "END";
export type ProcessRoutingMode = "AUTO_NEXT" | "SPECIFIED";
export type ProcessTransitionType = "DEFAULT" | "CONDITION";

export interface ProcessStep {
  id: string;
  order: number;
  name: string;
  owner: string;
  input: string;
  activity: string;
  output: string;
  standard: string;
  anomaly: string;
  nodeType: ProcessNodeType;
  routingMode: ProcessRoutingMode;
  decisionTitle: string;
  decisionBasis: string;
}

export interface ProcessTransition {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  transitionType: ProcessTransitionType;
  branchName: string;
  conditionExpression: string;
  isDefault: boolean;
  order: number;
}

export interface ProcessFinding {
  id: string;
  stepId: string;
  stepName: string;
  category: FindingCategory;
  title: string;
  evidence: string;
  impactMetric: string;
  completeness: number;
  question: string;
  priority: Priority;
  userEdited?: boolean;
}

export interface CauseHypothesis {
  id: string;
  findingId: string;
  stepName: string;
  kind: "直接原因" | "机制原因";
  statement: string;
  rationale: string;
  verificationMethod: "数据对比" | "现场观察" | "测量验证" | "对比试验" | "文件追溯";
  dataNeeded: string;
  decisionRule: string;
  owner: string;
  dueDate: string;
  result: string;
  status: EvidenceStatus;
  userEdited?: boolean;
}

export interface Countermeasure {
  id: string;
  causeId: string;
  cause: string;
  type: "快速改善" | "流程机制" | "数字化支持";
  action: string;
  pilotScope: string;
  ownerRole: string;
  successMetric: string;
  cycle: string;
  risk: string;
  rollback: string;
  impact: number;
  effort: number;
  speed: number;
  riskScore: number;
  totalScore: number;
  userEdited?: boolean;
}

export interface QccCase {
  id: string;
  title: string;
  problemType: ProblemType;
  object: string;
  location: string;
  period: string;
  frequency: string;
  impact: string;
  metric: string;
  baseline: string;
  target: string;
  dataDefinition: string;
  processStart: string;
  processEnd: string;
  processOwner: string;
  sanitizedConfirmed: boolean;
  steps: ProcessStep[];
  transitions: ProcessTransition[];
  findings: ProcessFinding[];
  hypotheses: CauseHypothesis[];
  countermeasures: Countermeasure[];
  stage: 1 | 2 | 3 | 4 | 5;
  status: "草稿" | "待诊断" | "验证中" | "方案设计" | "已完成";
  engine?: "规则引擎" | "AI模型" | "AI失败后规则引擎";
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CaseSummary {
  id: string;
  title: string;
  problemType: ProblemType;
  stage: number;
  status: QccCase["status"];
  findings: number;
  supportedCauses: number;
  updatedAt: string;
}

export interface AiRun {
  id: number;
  caseId: string;
  action: "diagnose" | "solutions";
  engine: string;
  model: string;
  inputSummary: string;
  outputJson: string;
  createdAt: string;
}
