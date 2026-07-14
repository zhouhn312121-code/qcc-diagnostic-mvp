import type { ProblemType, QccCase } from "./types";
import { normalizeCase, syncAutoTransitions } from "./case-utils";

const now = "2026-06-29T00:00:00.000Z";

type SampleSpec = {
  id: string; title: string; problemType: ProblemType; object: string; location: string; frequency: string; impact: string;
  metric: string; baseline: string; target: string; dataDefinition: string; processStart: string; processEnd: string; processOwner: string;
  steps: Array<[string, string, string, string, string, string, string]>;
};

const specs: SampleSpec[] = [
  {
    id: "sample_quality", title: "降低换线首件不良率", problemType: "质量", object: "A产线换线后的前30件产品", location: "装配车间A产线", frequency: "近3个月平均每周换线12次，首件不良率8.6%", impact: "月均返工工时96小时，并造成3次交付延迟",
    metric: "换线首件不良率", baseline: "8.6%", target: "≤3.0%", dataDefinition: "每次换线后前30件中的不良件数÷30，按换线批次统计", processStart: "生产计划下达换线指令", processEnd: "首件确认并恢复批量生产", processOwner: "制造部经理",
    steps: [
      ["下达换线指令", "计划员", "生产计划", "确认产品型号和切换时间", "换线任务", "提前2小时下达", "临时插单时频繁变更"],
      ["物料与工装准备", "物料员", "换线任务", "配送物料并准备工装", "齐套物料和工装", "物料清单齐套", "缺料信息通常到现场才暴露"],
      ["设备参数切换", "设备操作员", "产品参数版本", "调用参数并完成设备调整", "待试产设备", "", "偶发调用旧版本参数"],
      ["试产首件", "班组长", "待试产设备", "试产并抽取首件", "首件样品", "", "异常依赖个人经验判断"],
      ["质量确认", "检验员", "首件样品", "检查尺寸和外观并放行", "首件确认结果", "关键尺寸合格", "高峰期检验等待超过20分钟"],
    ],
  },
  {
    id: "sample_delivery", title: "缩短采购缺料响应周期", problemType: "交付", object: "影响生产的A类物料缺料异常", location: "计划—采购—供应商协同流程", frequency: "每月约35起缺料异常，平均关闭周期4.8天", impact: "造成月均18小时待料停线和加急物流费用",
    metric: "缺料异常关闭周期", baseline: "4.8天", target: "≤2天", dataDefinition: "从计划员登记缺料到采购确认到货或替代方案的自然日", processStart: "计划员识别缺料", processEnd: "到货或替代方案确认", processOwner: "供应链负责人",
    steps: [
      ["识别缺料", "计划员", "MRP结果", "核对库存和生产需求", "缺料清单", "每日更新", "清单在多个表格重复维护"],
      ["发布异常", "", "缺料清单", "通过群消息通知采购", "异常通知", "", "消息格式不统一"],
      ["供应商确认", "采购员", "异常通知", "联系供应商确认交期", "交期回复", "", "没有回复时限和升级规则"],
      ["方案评估", "计划/采购", "交期回复", "评估调整计划或替代料", "处理方案", "", "跨部门等待口头决策"],
      ["关闭异常", "计划员", "处理方案", "更新清单并通知车间", "关闭记录", "", "关闭原因和经验未沉淀"],
    ],
  },
  {
    id: "sample_inventory", title: "降低呆滞原材料库存", problemType: "库存", object: "超过180天未领用的原材料", location: "需求计划—采购—仓储流程", frequency: "呆滞金额连续6个月上升，当前860万元", impact: "占用资金并产生仓储、跌价和报废风险",
    metric: "呆滞原材料金额", baseline: "860万元", target: "≤600万元", dataDefinition: "库龄超过180天且未来90天无明确需求的原材料账面金额", processStart: "销售/计划形成物料需求", processEnd: "采购执行和库存处置", processOwner: "供应链总监",
    steps: [
      ["形成需求", "计划员", "销售预测", "计算物料需求", "需求计划", "月度滚动", "预测变化没有及时传递"],
      ["审核采购量", "采购经理", "需求计划", "结合库存确定采购量", "采购申请", "", "安全库存规则不清"],
      ["下达采购", "采购员", "采购申请", "向供应商下单", "采购订单", "", "最小起订量缺少专项评估"],
      ["收货入库", "仓管员", "到货物料", "验收入库并登记批次", "库存记录", "账实一致", "库龄信息无法主动预警"],
      ["呆滞处置", "", "库龄报表", "组织消耗、退换或报废", "处置结果", "季度评审", "没有持续责任人与关闭标准"],
    ],
  },
  {
    id: "sample_efficiency", title: "缩短成品入库等待时间", problemType: "效率", object: "包装完成等待入库的成品", location: "包装—检验—仓储交接流程", frequency: "每天约20批，平均等待95分钟", impact: "占用现场空间并造成重复搬运",
    metric: "成品入库等待时间", baseline: "95分钟", target: "≤40分钟", dataDefinition: "从包装完成扫码到仓库完成入库扫码的分钟数", processStart: "包装完成", processEnd: "仓库完成入库", processOwner: "生产运营经理",
    steps: [
      ["包装完成", "包装班组", "待包装成品", "完成包装并贴标", "包装成品", "标签正确", "批次完成时间波动大"],
      ["报检", "班组长", "包装成品", "填写报检信息", "报检单", "", "集中到下班前报检"],
      ["成品检验", "检验员", "报检单", "抽检并记录结论", "检验结果", "", "检验任务无优先级"],
      ["入库预约", "", "检验结果", "通知仓库安排库位", "入库通知", "", "主要依赖电话和群消息"],
      ["搬运入库", "仓管员", "入库通知", "搬运、核对并完成入库", "库存记录", "账物一致", "异常批次退回后无人跟踪"],
    ],
  },
  {
    id: "sample_collaboration", title: "提高工程变更按期执行率", problemType: "协同", object: "涉及生产和供应链的工程变更", location: "研发—工艺—采购—生产变更流程", frequency: "近季度42项变更，按期执行率61%", impact: "造成旧料积压、现场返工和版本混用风险",
    metric: "工程变更按期执行率", baseline: "61%", target: "≥90%", dataDefinition: "在计划生效日前完成物料、工艺、系统和现场切换的变更项数÷应执行项数", processStart: "研发批准工程变更", processEnd: "现场切换并关闭变更", processOwner: "研发运营负责人",
    steps: [
      ["发布变更", "研发工程师", "批准后的ECN", "发布变更内容和生效要求", "变更通知", "", "影响范围由研发自行判断"],
      ["评估影响", "各部门接口人", "变更通知", "评估库存、供应商、工艺和订单影响", "影响评估", "", "各部门反馈格式和时限不同"],
      ["制定切换计划", "项目经理", "影响评估", "确定旧料处理和切换节点", "切换计划", "", "冲突事项缺少决策人"],
      ["执行变更", "生产/采购", "切换计划", "完成物料、文件和现场切换", "执行记录", "", "系统与现场版本偶有不同步"],
      ["验证关闭", "质量工程师", "执行记录", "核查执行结果并关闭", "关闭结论", "", "延期原因未形成分类复盘"],
    ],
  },
];

export function sampleCases(): QccCase[] {
  return specs.map((spec) => syncAutoTransitions(normalizeCase({
    id: spec.id, title: spec.title, problemType: spec.problemType, object: spec.object, location: spec.location,
    period: "2026年4–6月", frequency: spec.frequency, impact: spec.impact, metric: spec.metric, baseline: spec.baseline,
    target: spec.target, dataDefinition: spec.dataDefinition, processStart: spec.processStart, processEnd: spec.processEnd,
    processOwner: spec.processOwner, sanitizedConfirmed: true,
    steps: spec.steps.map(([name, owner, input, activity, output, standard, anomaly], index) => ({ id: `${spec.id}_step_${index + 1}`, order: index + 1, name, owner, input, activity, output, standard, anomaly, nodeType: "ACTION" as const, routingMode: "AUTO_NEXT" as const, decisionTitle: "", decisionBasis: "", positionX: 80 + index * 220, positionY: 120, lane: owner })),
    transitions: [], processFacts: [], toBeProcess: null, asIsDrawio: null, toBeDrawio: null, diagnosisStale: false, version: 1,
    findings: [], hypotheses: [], countermeasures: [], stage: 1, status: "待诊断", createdAt: now, updatedAt: now,
  })));
}
