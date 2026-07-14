import { z } from "zod";
import { makeId } from "./ids";
import type { ProcessStep, ProcessTransition } from "./types";

const confidence = z.number().min(0).max(1);

export const visionProcessSchema = z.object({
  summary: z.string().default(""),
  lanes: z.array(z.object({ id: z.string().min(1), name: z.string(), order: z.number().int().nonnegative(), confidence })).max(30),
  nodes: z.array(z.object({
    id: z.string().min(1), name: z.string(), nodeType: z.enum(["START", "ACTION", "DECISION", "END"]),
    owner: z.string().default(""), lane: z.string().default(""), input: z.string().default(""), activity: z.string().default(""),
    output: z.string().default(""), standard: z.string().default(""), confidence,
  })).min(1).max(20),
  transitions: z.array(z.object({
    id: z.string().min(1), sourceNodeId: z.string().min(1), targetNodeId: z.string().min(1),
    branchName: z.string().default(""), conditionExpression: z.string().default(""), confidence,
  })).max(60),
  uncertainties: z.array(z.object({
    id: z.string().min(1), kind: z.enum(["NODE", "EDGE", "LANE", "TEXT"]), targetId: z.string().default(""),
    question: z.string(), suggestion: z.string().default(""), confidence,
  })).max(50),
});

export type VisionProcessResult = z.infer<typeof visionProcessSchema>;

export function validateVisionProcess(result: VisionProcessResult): string[] {
  const issues: string[] = [];
  const nodeIds = new Set(result.nodes.map((node) => node.id));
  if (nodeIds.size !== result.nodes.length) issues.push("存在重复的节点ID，请删除重复节点后重试");
  if (new Set(result.transitions.map((edge) => edge.id)).size !== result.transitions.length) issues.push("存在重复的连线ID，请删除重复连线后重试");
  const starts = result.nodes.filter((node) => node.nodeType === "START").length;
  const ends = result.nodes.filter((node) => node.nodeType === "END").length;
  if (starts !== 1) issues.push(starts ? "识别结果只能保留一个开始节点" : "没有识别到开始节点");
  if (!ends) issues.push("没有识别到结束节点");
  for (const transition of result.transitions) {
    if (!nodeIds.has(transition.sourceNodeId) || !nodeIds.has(transition.targetNodeId)) issues.push(`连线${transition.id}指向不存在的节点`);
    if (transition.sourceNodeId === transition.targetNodeId) issues.push(`连线${transition.id}不能连接节点自身`);
  }
  for (const node of result.nodes) {
    const incoming = result.transitions.some((edge) => edge.targetNodeId === node.id);
    const outgoing = result.transitions.filter((edge) => edge.sourceNodeId === node.id);
    if (node.nodeType !== "START" && !incoming) issues.push(`${node.name || node.id}没有前置连线`);
    if (node.nodeType !== "END" && !outgoing.length) issues.push(`${node.name || node.id}没有后续连线`);
    if (node.nodeType === "DECISION" && outgoing.length < 2) issues.push(`${node.name || node.id}的判断分支少于2条`);
    if (node.nodeType === "DECISION" && outgoing.some((edge) => !edge.branchName.trim())) issues.push(`${node.name || node.id}存在未命名的判断分支`);
  }
  return [...new Set(issues)];
}

export function visionResultToProcess(result: VisionProcessResult): { steps: ProcessStep[]; transitions: ProcessTransition[] } {
  const lanes = [...result.lanes].sort((a, b) => a.order - b.order);
  const laneIndex = new Map(lanes.map((lane, index) => [lane.name, index]));
  const idMap = new Map(result.nodes.map((node) => [node.id, makeId("step")]));
  const steps: ProcessStep[] = result.nodes.map((node, index) => ({
    id: idMap.get(node.id)!, order: index + 1, name: node.name, owner: node.owner || node.lane, input: node.input,
    activity: node.activity || (node.nodeType === "ACTION" ? node.name : ""), output: node.output, standard: node.standard,
    anomaly: "", nodeType: node.nodeType, routingMode: "SPECIFIED", decisionTitle: node.nodeType === "DECISION" ? node.name : "",
    decisionBasis: "", positionX: 80 + (index % 5) * 220, positionY: 90 + (laneIndex.get(node.lane) ?? Math.floor(index / 5)) * 170,
    lane: node.lane || node.owner, participants: "", decisionRole: "", escalationRole: "", systemTools: "", dataSource: "",
    entryMethod: "", duplicateEntry: "", systemOutput: "", automationControl: "", offlineWork: "", normalRule: "",
    exceptionRule: "", escalationRule: "", closureRule: "", policyReference: "",
  }));
  const transitions: ProcessTransition[] = result.transitions.flatMap((edge) => {
    const sourceNodeId = idMap.get(edge.sourceNodeId); const targetNodeId = idMap.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) return [];
    const source = result.nodes.find((node) => node.id === edge.sourceNodeId);
    return [{ id: makeId("transition"), sourceNodeId, targetNodeId, transitionType: source?.nodeType === "DECISION" ? "CONDITION" as const : "DEFAULT" as const, branchName: edge.branchName, conditionExpression: edge.conditionExpression, isDefault: !edge.branchName, order: result.transitions.filter((candidate) => candidate.sourceNodeId === edge.sourceNodeId).findIndex((candidate) => candidate.id === edge.id) + 1 }];
  });
  return { steps, transitions };
}
