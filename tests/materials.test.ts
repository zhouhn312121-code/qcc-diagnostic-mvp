import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractProblemCandidates, parseMaterial } from "@/lib/materials";

describe("material problem extraction", () => {
  it("classifies organization, IT, rule and process observations", () => {
    const candidates = extractProblemCandidates([
      { location: "第1页", text: "岗位职责不清，异常发生后无人决策。ERP与Excel需要重复录入订单数据。制度未规定异常升级时限。跨部门交接平均等待两天。" },
    ]);
    expect(candidates.map((value) => value.problemCategory)).toEqual(expect.arrayContaining(["组织类", "IT类", "管理规则类", "流程类"]));
    expect(candidates.every((value) => value.sourceLocation === "第1页")).toBe(true);
  });

  it("reads XLSX rows and preserves worksheet locations", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("访谈记录");
    sheet.addRow(["问题", "ERP与Excel重复录入，导致数据不一致"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await parseMaterial("问题清单.xlsx", buffer);
    expect(result.candidates[0].problemCategory).toBe("IT类");
    expect(result.candidates[0].sourceLocation).toContain("访谈记录");
  });

  it("rejects unsupported files", async () => {
    await expect(parseMaterial("问题清单.doc", Buffer.from("x"))).rejects.toThrow("仅支持DOCX、XLSX和PDF文件");
  });
});
