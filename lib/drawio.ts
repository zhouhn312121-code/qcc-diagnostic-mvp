import { makeId } from "./ids";
import type { ProcessChange, ProcessFact, ProcessNodeType, ProcessStep, ProcessTransition, QccCase } from "./types";

export type DrawioCell = {
  id: string;
  type: "layer" | "group" | "node" | "edge";
  parent?: string;
  source?: string;
  target?: string;
  label?: string;
  metadata?: Record<string, string>;
};

export type DrawioJson = { pages?: Array<{ cells?: DrawioCell[] }> };

export type DrawioConversion = {
  steps: ProcessStep[];
  transitions: ProcessTransition[];
  ignored: Array<{ id: string; label: string }>;
  errors: string[];
  warnings: string[];
  impact: { deletedNodeIds: string[]; deletedTransitionIds: string[]; orphanFactIds: string[]; findings: number; hypotheses: number; hasToBe: boolean };
};

const nodeTypes = new Set<ProcessNodeType>(["START", "ACTION", "DECISION", "END"]);
const value = (input: unknown) => typeof input === "string" ? input.trim() : "";

function safeId(input: string, prefix: string) {
  const cleaned = input.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned ? `${prefix}_${cleaned}` : makeId(prefix);
}

export function convertDrawio(diagram: DrawioJson, current: QccCase, stage: "AS_IS" | "TO_BE"): DrawioConversion {
  const cells = diagram.pages?.flatMap((page) => page.cells || []) || [];
  const processCells = cells.filter((cell) => cell.type === "node" && nodeTypes.has(value(cell.metadata?.qccType) as ProcessNodeType));
  const usedIds = new Set<string>();
  const cellToNode = new Map<string, string>();
  const lanes = new Map(cells.filter((cell) => cell.metadata?.qccType === "LANE").map((cell) => [cell.id, value(cell.label)]));
  const laneRows = new Map<string, number>();
  const steps = processCells.slice(0, 20).map((cell, index) => {
    const metadata = cell.metadata || {};
    const requestedId = value(metadata.qccNodeId) || safeId(cell.id, "drawio");
    const id = usedIds.has(requestedId) ? makeId("step") : requestedId;
    usedIds.add(id); cellToNode.set(cell.id, id);
    const owner = value(metadata.qccOwner) || value(lanes.get(cell.parent || ""));
    if (!laneRows.has(owner)) laneRows.set(owner, laneRows.size);
    const nodeType = value(metadata.qccType) as ProcessNodeType;
    return {
      id, order: index + 1, name: value(cell.label) || (nodeType === "START" ? "流程开始" : nodeType === "END" ? "流程结束" : nodeType === "DECISION" ? "新判断" : "新步骤"),
      owner, input: value(metadata.qccInput), activity: value(metadata.qccActivity), output: value(metadata.qccOutput), standard: value(metadata.qccStandard), anomaly: "",
      nodeType, routingMode: "SPECIFIED" as const, decisionTitle: nodeType === "DECISION" ? value(cell.label) || "是否满足条件？" : "", decisionBasis: value(metadata.qccDecisionBasis),
      positionX: 80 + (index % 5) * 220, positionY: 90 + (laneRows.get(owner) || 0) * 150, lane: owner,
    };
  });
  const transitionCells = cells.filter((cell) => cell.type === "edge");
  const transitions = transitionCells.flatMap((cell, index) => {
    const sourceNodeId = cell.source ? cellToNode.get(cell.source) : undefined;
    const targetNodeId = cell.target ? cellToNode.get(cell.target) : undefined;
    if (!sourceNodeId || !targetNodeId) return [];
    const source = steps.find((step) => step.id === sourceNodeId);
    const branchName = value(cell.metadata?.qccBranchName) || value(cell.label);
    return [{
      id: value(cell.metadata?.qccTransitionId) || safeId(cell.id, "transition"), sourceNodeId, targetNodeId,
      transitionType: source?.nodeType === "DECISION" ? "CONDITION" as const : "DEFAULT" as const,
      branchName, conditionExpression: value(cell.metadata?.qccCondition), isDefault: value(cell.metadata?.qccDefault) === "true", order: index + 1,
    }];
  });
  const ignored = cells.filter((cell) => cell.type === "node" && !nodeTypes.has(value(cell.metadata?.qccType) as ProcessNodeType) && cell.metadata?.qccType !== "LANE").map((cell) => ({ id: cell.id, label: value(cell.label) || "未命名图形" }));
  const errors = validateConvertedProcess(steps, transitions);
  if (processCells.length > 20) errors.push("流程节点超过20个，请精简后重新应用");
  const warnings = ignored.length ? [`${ignored.length}个非QCC图形将作为装饰忽略`] : [];
  const currentSteps = stage === "AS_IS" ? current.steps : current.toBeProcess?.steps || [];
  const currentTransitions = stage === "AS_IS" ? current.transitions : current.toBeProcess?.transitions || [];
  const nextIds = new Set(steps.map((step) => step.id));
  const nextTransitionIds = new Set(transitions.map((transition) => transition.id));
  const deletedNodeIds = currentSteps.filter((step) => !nextIds.has(step.id)).map((step) => step.id);
  const deletedTransitionIds = currentTransitions.filter((transition) => !nextTransitionIds.has(transition.id)).map((transition) => transition.id);
  const orphanFactIds = stage === "AS_IS" ? current.processFacts.filter((fact) => fact.anchorType === "NODE" ? deletedNodeIds.includes(fact.anchorId) : fact.anchorType === "EDGE" ? deletedTransitionIds.includes(fact.anchorId) : false).map((fact) => fact.id) : [];
  return { steps, transitions, ignored, errors: [...new Set(errors)], warnings, impact: { deletedNodeIds, deletedTransitionIds, orphanFactIds, findings: stage === "AS_IS" ? current.findings.length : 0, hypotheses: stage === "AS_IS" ? current.hypotheses.length : 0, hasToBe: stage === "AS_IS" && Boolean(current.toBeProcess) } };
}

export function validateConvertedProcess(steps: ProcessStep[], transitions: ProcessTransition[]): string[] {
  const errors: string[] = [];
  const starts = steps.filter((step) => step.nodeType === "START");
  const ends = steps.filter((step) => step.nodeType === "END");
  if (starts.length !== 1) errors.push(starts.length ? "只能保留一个开始节点" : "缺少开始节点");
  if (!ends.length) errors.push("至少需要一个结束节点");
  const ids = new Set(steps.map((step) => step.id));
  steps.forEach((step) => {
    const outgoing = transitions.filter((transition) => transition.sourceNodeId === step.id);
    const incoming = transitions.filter((transition) => transition.targetNodeId === step.id);
    if (step.nodeType !== "START" && !incoming.length) errors.push(`${step.name}是孤立节点或没有上一步`);
    if (step.nodeType !== "END" && !outgoing.length) errors.push(`${step.name}没有后续流转`);
    if (step.nodeType === "DECISION") {
      if (outgoing.length < 2) errors.push(`${step.name}至少需要两个判断分支`);
      if (outgoing.some((transition) => !transition.branchName.trim() || !transition.conditionExpression.trim())) errors.push(`${step.name}的每个分支都要填写名称和条件`);
    }
    if (step.nodeType === "ACTION" || step.nodeType === "DECISION") {
      const missing = [["责任岗位", step.owner], ["输入", step.input], ["实际活动", step.activity], ["输出", step.output], ["标准/时限", step.standard]].filter(([, field]) => !field.trim()).map(([label]) => label);
      if (missing.length) errors.push(`${step.name}缺少${missing.join("、")}`);
    }
  });
  transitions.forEach((transition) => { if (!ids.has(transition.sourceNodeId) || !ids.has(transition.targetNodeId)) errors.push("存在指向无效节点的连线"); });
  return errors;
}

const escapeXml = (input: string) => input.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (name: string, input: string) => `${name}="${escapeXml(input)}"`;

export function processToDrawioXml(steps: ProcessStep[], transitions: ProcessTransition[]): string {
  const laneNames = [...new Set(steps.map((step) => step.lane || step.owner).filter(Boolean))];
  const laneIds = new Map(laneNames.map((name, index) => [name, `qcc_lane_${index + 1}`]));
  const canvasWidth = Math.max(1200, steps.length * 190 + 300);
  const laneCells = laneNames.map((name, index) => `<object id="${laneIds.get(name)}" ${attr("label", name)} qccType="LANE"><mxCell style="swimlane;horizontal=0;startSize=110;container=1;collapsible=0;recursiveResize=0;fillColor=${["#f5f5f5", "#e8f4f8", "#fff0e6", "#e8f5e9", "#fff9e6", "#fce4ec"][index % 6]};strokeColor=#9dcde3;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="${index * 150}" width="${canvasWidth}" height="150" as="geometry"/></mxCell></object>`).join("");
  const nodeCells = steps.map((step) => {
    const style = step.nodeType === "DECISION" ? "rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" : step.nodeType === "START" || step.nodeType === "END" ? "ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#eaf3f8;strokeColor=#087eb7;" : "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#7892aa;";
    const width = step.nodeType === "START" || step.nodeType === "END" ? 90 : 150;
    const height = step.nodeType === "DECISION" ? 90 : 70;
    const laneName = step.lane || step.owner;
    const parent = laneIds.get(laneName) || "1";
    const x = parent === "1" ? step.positionX : 120 + Math.max(0, step.order - 1) * 180;
    const y = parent === "1" ? step.positionY : 45;
    return `<object id="${escapeXml(step.id)}" ${attr("label", step.nodeType === "DECISION" ? step.decisionTitle || step.name : step.name)} ${attr("qccType", step.nodeType)} ${attr("qccNodeId", step.id)} ${attr("qccOwner", step.owner)} ${attr("qccInput", step.input)} ${attr("qccActivity", step.activity)} ${attr("qccOutput", step.output)} ${attr("qccStandard", step.standard)} ${attr("qccDecisionBasis", step.decisionBasis)}><mxCell style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell></object>`;
  }).join("");
  const edgeCells = transitions.map((transition) => `<object id="${escapeXml(transition.id)}" ${attr("label", transition.branchName)} ${attr("qccTransitionId", transition.id)} ${attr("qccBranchName", transition.branchName)} ${attr("qccCondition", transition.conditionExpression)} ${attr("qccDefault", String(transition.isDefault))}><mxCell style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;" edge="1" parent="1" source="${escapeXml(transition.sourceNodeId)}" target="${escapeXml(transition.targetNodeId)}"><mxGeometry relative="1" as="geometry"/></mxCell></object>`).join("");
  return `<mxfile host="QCC" modified="${new Date().toISOString()}" version="1"><diagram id="qcc" name="QCC流程"><mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${laneCells}${nodeCells}${edgeCells}</root></mxGraphModel></diagram></mxfile>`;
}

export function qccNodeMergeXml(nodeType: ProcessNodeType, index: number): string {
  const step: ProcessStep = {
    id: makeId("step"), order: 1, name: nodeType === "START" ? "流程开始" : nodeType === "END" ? "流程结束" : nodeType === "DECISION" ? "是否满足条件？" : "新步骤",
    owner: "", input: "", activity: "", output: "", standard: "", anomaly: "", nodeType, routingMode: "SPECIFIED", decisionTitle: nodeType === "DECISION" ? "是否满足条件？" : "", decisionBasis: "", positionX: 80 + (index % 5) * 180, positionY: 120 + Math.floor(index / 5) * 130, lane: "",
  };
  return processToDrawioXml([step], []);
}

export function qccLaneMergeXml(index: number): string {
  const id = makeId("lane");
  const stepId = makeId("step");
  return `<mxfile host="QCC"><diagram id="qcc-lane-${index}" name="QCC泳道"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="${id}" label="责任部门" qccType="LANE"><mxCell style="swimlane;horizontal=0;startSize=110;container=1;collapsible=0;recursiveResize=0;fillColor=#e8f4f8;strokeColor=#9dcde3;html=1;" vertex="1" parent="1"><mxGeometry x="${20 + index * 16}" y="${30 + index * 150}" width="1600" height="150" as="geometry"/></mxCell></object><object id="${stepId}" label="泳道内活动" qccType="ACTION" qccNodeId="${stepId}" qccOwner="责任部门" qccInput="" qccActivity="" qccOutput="" qccStandard=""><mxCell style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#7892aa;" vertex="1" parent="${id}"><mxGeometry x="120" y="45" width="150" height="60" as="geometry"/></mxCell></object></root></mxGraphModel></diagram></mxfile>`;
}

export function calculateProcessChanges(asIs: ProcessStep[], toBe: ProcessStep[], causeIds: string[], measureIds: string[]): ProcessChange[] {
  const changes: ProcessChange[] = [];
  const asIsById = new Map(asIs.map((step) => [step.id, step]));
  const toBeById = new Map(toBe.map((step) => [step.id, step]));
  asIs.forEach((step) => { if (!toBeById.has(step.id)) changes.push({ id: makeId("change"), stepId: step.id, changeType: "删除", description: `删除“${step.name}”节点`, causeIds, measureIds }); });
  toBe.forEach((step) => {
    const before = asIsById.get(step.id);
    if (!before) changes.push({ id: makeId("change"), stepId: step.id, changeType: "新增", description: `新增“${step.name}”节点`, causeIds, measureIds });
    else if (["name", "owner", "input", "activity", "output", "standard", "nodeType"].some((key) => before[key as keyof ProcessStep] !== step[key as keyof ProcessStep])) changes.push({ id: makeId("change"), stepId: step.id, changeType: "调整", description: `调整“${step.name}”的责任、活动或控制标准`, causeIds, measureIds });
  });
  return changes;
}

export function reanchorFacts(facts: ProcessFact[], mapping: Record<string, string>, steps: ProcessStep[], transitions: ProcessTransition[]): ProcessFact[] {
  return facts.flatMap((fact) => {
    const target = mapping[fact.id];
    if (!target) return [fact];
    if (target === "DELETE") return [];
    const step = steps.find((candidate) => candidate.id === target);
    const transition = transitions.find((candidate) => candidate.id === target);
    if (!step && !transition) return [fact];
    return [{ ...fact, anchorType: step ? "NODE" as const : "EDGE" as const, anchorId: target, anchorLabel: step?.name || `${steps.find((candidate) => candidate.id === transition?.sourceNodeId)?.name || "?"} → ${steps.find((candidate) => candidate.id === transition?.targetNodeId)?.name || "?"}` }];
  });
}
