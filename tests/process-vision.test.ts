import { afterEach, describe, expect, it, vi } from "vitest";
import { validateVisionProcess, visionResultToProcess, type VisionProcessResult } from "@/lib/process-vision";
import { analyzeProcessDiagram } from "@/lib/qwen-vision";

const validResult: VisionProcessResult = {
  summary: "订单审批流程",
  lanes: [{ id: "lane_1", name: "销售", order: 0, confidence: 0.96 }],
  nodes: [
    { id: "n1", name: "开始", nodeType: "START", owner: "", lane: "", input: "", activity: "", output: "", standard: "", confidence: 0.99 },
    { id: "n2", name: "审批订单", nodeType: "ACTION", owner: "销售", lane: "销售", input: "订单", activity: "审批订单", output: "审批结果", standard: "1小时", confidence: 0.94 },
    { id: "n3", name: "结束", nodeType: "END", owner: "", lane: "", input: "", activity: "", output: "", standard: "", confidence: 0.99 },
  ],
  transitions: [
    { id: "e1", sourceNodeId: "n1", targetNodeId: "n2", branchName: "", conditionExpression: "", confidence: 0.98 },
    { id: "e2", sourceNodeId: "n2", targetNodeId: "n3", branchName: "", conditionExpression: "", confidence: 0.98 },
  ],
  uncertainties: [],
};

afterEach(() => {
  delete process.env.VISION_API_KEY;
  delete process.env.VISION_API_BASE_URL;
  delete process.env.VISION_MODEL;
  vi.unstubAllGlobals();
});

describe("process diagram vision conversion", () => {
  it("converts validated vision nodes and arrows into QCC process data", () => {
    expect(validateVisionProcess(validResult)).toEqual([]);
    const process = visionResultToProcess(validResult);
    expect(process.steps).toHaveLength(3);
    expect(process.steps[1]).toMatchObject({ name: "审批订单", owner: "销售", lane: "销售" });
    expect(process.transitions[0].sourceNodeId).toBe(process.steps[0].id);
    expect(process.transitions[0].targetNodeId).toBe(process.steps[1].id);
  });

  it("blocks structurally incomplete recognition results", () => {
    const invalid = { ...validResult, nodes: validResult.nodes.filter((node) => node.nodeType !== "END"), transitions: [] };
    expect(validateVisionProcess(invalid)).toEqual(expect.arrayContaining(["没有识别到结束节点", "开始没有后续连线", "审批订单没有前置连线", "审批订单没有后续连线"]));
  });

  it("calls qwen3.7-plus with a base64 image and parses structured JSON", async () => {
    process.env.VISION_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("qwen3.7-plus");
      expect(body.enable_thinking).toBe(false);
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages[1].content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validResult) } }] }), { status: 200, headers: { "x-request-id": "request-test" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([137, 80, 78, 71])], "flow.png", { type: "image/png" });
    const analysis = await analyzeProcessDiagram(file);
    expect(analysis.result.summary).toBe("订单审批流程");
    expect(analysis.validationIssues).toEqual([]);
    expect(analysis.requestId).toBe("request-test");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
