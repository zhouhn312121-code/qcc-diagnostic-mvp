"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpenCheck, CheckCircle2, Clipboard, Download, FileSearch, GitBranch, Lightbulb, Plus, Printer, Save, ShieldAlert, Sparkles, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { caseProgress, emptyStep, hasProcessLoop, processIssues, readinessIssues, syncAutoTransitions } from "@/lib/case-utils";
import { makeId } from "@/lib/ids";
import { problemCategories, problemTypes, type CauseHypothesis, type Countermeasure, type ProcessFinding, type ProcessStep, type ProcessTransition, type QccCase } from "@/lib/types";
import type { ModelOption } from "@/lib/ai";
import { GuidedFactsPanel, ProcessCanvas, ToBeWorkbench, UploadSimulator } from "@/components/ProcessWorkbench";
import { DrawioWorkbench } from "@/components/DrawioWorkbench";

const stages = [
  { id: 1, label: "问题与流程", icon: GitBranch },
  { id: 2, label: "现状诊断", icon: FileSearch },
  { id: 3, label: "根因验证", icon: ShieldAlert },
  { id: 4, label: "改善方案", icon: Lightbulb },
  { id: 5, label: "报告导出", icon: BookOpenCheck },
];

function badgeClass(value: string) {
  if (["证据支持", "高", "已完成"].includes(value)) return "green";
  if (["证据不支持", "不通过"].includes(value)) return "red";
  if (["证据不足", "待验证", "中"].includes(value)) return "amber";
  return "gray";
}

function Field({ label, value, onChange, placeholder, full, textarea, help }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; full?: boolean; textarea?: boolean; help?: string }) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {textarea ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /> : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function CaseWorkspace({ initialCase, modelOptions }: { initialCase: QccCase; modelOptions: ModelOption[] }) {
  const [item, setItem] = useState(initialCase);
  const [activeStage, setActiveStage] = useState(Math.min(initialCase.stage, 5));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "retrying" | "failed">("saved");
  const [draft, setDraft] = useState<QccCase | null>(null);
  const [running, setRunning] = useState<"diagnose" | "solutions" | "tobe" | null>(null);
  const [toast, setToast] = useState("");
  const router = useRouter();
  const itemRef = useRef(item);
  const revisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<QccCase | null>>(Promise.resolve(null));
  const issues = useMemo(() => readinessIssues(item), [item]);
  const progress = useMemo(() => caseProgress(item), [item]);

  function notify(message: string) {
    setToast(message); window.setTimeout(() => setToast(""), 2800);
  }
  useEffect(() => { itemRef.current = item; }, [item]);
  useEffect(() => {
    const key = `qcc-draft:${initialCase.id}`;
    const stored = window.localStorage.getItem(key);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as QccCase;
      if (new Date(parsed.updatedAt).getTime() >= new Date(initialCase.updatedAt).getTime()) setDraft(parsed);
    } catch { window.localStorage.removeItem(key); }
  }, [initialCase.id, initialCase.updatedAt]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update(next: QccCase) {
    revisionRef.current += 1; itemRef.current = next; setItem(next); setDirty(true); setSaveStatus("dirty");
    window.localStorage.setItem(`qcc-draft:${next.id}`, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }));
  }
  function updateField<K extends keyof QccCase>(key: K, value: QccCase[K]) { update({ ...item, [key]: value }); }

  const performSave = useCallback(async (snapshot: QccCase, revision: number, silent: boolean) => {
    setSaving(true); setSaveStatus("saving");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const payload = { ...snapshot, version: itemRef.current.version };
        const response = await fetch(`/api/cases/${snapshot.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(data.error || "保存失败") as Error & { retryable?: boolean };
          error.retryable = response.status >= 500; throw error;
        }
        const saved = data.case as QccCase;
        if (revisionRef.current === revision) {
          itemRef.current = saved; setItem(saved); setDirty(false); setSaveStatus("saved");
          window.localStorage.removeItem(`qcc-draft:${snapshot.id}`);
        } else {
          setItem((current) => { const next = { ...current, version: saved.version, updatedAt: saved.updatedAt }; itemRef.current = next; return next; });
          setSaveStatus("dirty");
        }
        if (!silent) notify("课题已保存");
        return saved;
      } catch (error) {
        const retryable = error instanceof DOMException && error.name === "AbortError" || Boolean((error as Error & { retryable?: boolean }).retryable) || error instanceof TypeError;
        if (!retryable || attempt === 2) { setSaveStatus("failed"); notify(error instanceof Error ? error.message : "保存失败"); return null; }
        setSaveStatus("retrying"); await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
      } finally { window.clearTimeout(timeout); }
    }
    return null;
  }, []);
  const save = useCallback((silent = false) => {
    const snapshot = itemRef.current; const revision = revisionRef.current;
    const queued = saveQueueRef.current.then(() => performSave(snapshot, revision, silent));
    saveQueueRef.current = queued.finally(() => { setSaving(false); });
    return queued;
  }, [performSave]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => { void save(true); }, 2000);
    return () => window.clearTimeout(timer);
  }, [dirty, item, save]);

  async function runDiagnosis() {
    if (issues.length) { notify(`还有${issues.length}项信息需要补充`); return; }
    const saved = await save(true); if (!saved) return;
    setRunning("diagnose");
    try {
      const response = await fetch("/api/diagnose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: item.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "诊断失败");
      const modelLabel = modelOptions.find((option) => option.id === data.model)?.label || data.engine;
      setItem(data.case); setDirty(false); setActiveStage(2); notify(data.engine === "AI失败后规则引擎" ? `${modelLabel}调用失败，已使用规则引擎完成诊断` : `诊断完成 · ${modelLabel}`);
    } catch (error) { notify(error instanceof Error ? error.message : "诊断失败"); }
    finally { setRunning(null); }
  }

  async function generateSolutions() {
    const supported = item.hypotheses.filter((h) => h.status === "证据支持");
    if (!supported.length) { notify("请先完成至少一个原因验证"); return; }
    const saved = await save(true); if (!saved) return;
    setRunning("solutions");
    try {
      const response = await fetch("/api/solutions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: item.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "方案生成失败");
      const modelLabel = modelOptions.find((option) => option.id === data.model)?.label || data.engine;
      setItem(data.case); setDirty(false); setActiveStage(4); notify(data.engine === "AI失败后规则引擎" ? `${modelLabel}调用失败，已使用规则引擎生成方案` : `方案生成完成 · ${modelLabel}`);
    } catch (error) { notify(error instanceof Error ? error.message : "方案生成失败"); }
    finally { setRunning(null); }
  }
  async function generateToBe(mode: "COPY" | "AI", replace = false) {
    const supported = item.hypotheses.filter((h) => h.status === "证据支持");
    if (!supported.length) { notify("请先完成至少一个原因验证"); return; }
    if (item.toBeProcess?.userEdited && replace && !window.confirm("当前TO BE流程已有人工修改。重新生成将覆盖现有草案，是否继续？")) return;
    const saved = await save(true); if (!saved) return; setRunning("tobe");
    try { const response = await fetch("/api/tobe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: item.id, mode, replace }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "TO BE生成失败"); setItem(data.case); setDirty(false); setActiveStage(4); notify(mode === "COPY" ? "已复制AS IS，可开始编辑TO BE" : "TO BE草案已生成"); }
    catch (error) { notify(error instanceof Error ? error.message : "TO BE生成失败"); } finally { setRunning(null); }
  }

  function updateStep(index: number, key: keyof QccCase["steps"][number], value: ProcessStep[keyof ProcessStep]) {
    const steps = [...item.steps]; steps[index] = { ...steps[index], [key]: value }; update({ ...item, steps, asIsDrawio: item.asIsDrawio ? { ...item.asIsDrawio, syncStatus: "STALE" } : null, toBeDrawio: item.toBeDrawio ? { ...item.toBeDrawio, syncStatus: "STALE" } : null, diagnosisStale: item.findings.length > 0 });
  }
  function updateFinding(index: number, patch: Partial<ProcessFinding>) {
    const findings = [...item.findings]; findings[index] = { ...findings[index], ...patch, userEdited: true }; update({ ...item, findings });
  }
  function updateCause(index: number, patch: Partial<CauseHypothesis>) {
    const hypotheses = [...item.hypotheses];
    if (patch.status === "证据支持" && !hypotheses[index].result.trim()) { notify("请先填写验证结果，再标记为证据支持"); return; }
    hypotheses[index] = { ...hypotheses[index], ...patch, userEdited: true }; update({ ...item, hypotheses });
  }
  function updateMeasure(index: number, patch: Partial<Countermeasure>) {
    const countermeasures = [...item.countermeasures];
    const next = { ...countermeasures[index], ...patch, userEdited: true };
    next.totalScore = Number((next.impact * .35 + (6 - next.effort) * .25 + next.speed * .25 + (6 - next.riskScore) * .15).toFixed(2));
    countermeasures[index] = next; update({ ...item, countermeasures });
  }
  async function copyA3() {
    const supported = item.hypotheses.filter((h) => h.status === "证据支持");
    const categorySummary = problemCategories.map((category) => `${category}${item.processFacts.filter((fact) => fact.problemCategory === category).length}项`).join("、");
    const text = [
      `【课题】${item.title}`,
      `【一、问题与流程】${item.metric}：基线${item.baseline}，目标${item.target}；口径：${item.dataDefinition}。流程边界：${item.processStart} → ${item.processEnd}。`,
      `【二、现状诊断】共${item.processFacts.length}项问题，${categorySummary}。\n${item.findings.filter((f) => f.priority === "高").map((f, i) => `${i + 1}. ${f.dimension}｜${f.title}`).join("\n") || "待完成诊断"}`,
      `【三、根因验证】${supported.length}项原因获得证据支持。\n${supported.map((h, i) => `${i + 1}. ${h.statement}；证据：${h.result}`).join("\n") || "尚无"}`,
      `【四、改善方案】\nTO BE变更：${item.toBeProcess?.changes.map((c) => `[${c.changeType}]${c.description}`).join("；") || "尚未设计"}\n详细措施：${item.countermeasures.sort((a,b) => b.totalScore-a.totalScore).slice(0,6).map((m,i) => `${i+1}. [${m.type}] ${m.action}`).join("\n") || "待生成"}`,
      `【流程图来源】AS IS：${item.asIsDrawio ? `draw.io（${item.asIsDrawio.syncStatus}）` : "智能流程搭建"}；TO BE：${item.toBeDrawio ? `draw.io（${item.toBeDrawio.syncStatus}）` : item.toBeProcess ? "智能流程搭建" : "尚未设计"}${item.diagnosisStale ? "；AS IS已变化，需重新诊断" : ""}`,
    ].join("\n\n");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text); notify("A3结构化文本已复制");
    } catch {
      window.prompt("浏览器未允许自动复制，请在下方全选并复制A3文本：", text);
      notify("未获得剪贴板权限，已打开手工复制窗口");
    }
  }

  return (
    <div className="workspace">
      <aside className="side-nav no-print">
        <Link href="/" className="back-link"><ArrowLeft size={15}/> 返回课题列表</Link>
        <nav className="stage-list">
          {stages.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`stage-button ${activeStage === id ? "active" : ""}`} onClick={() => setActiveStage(id)}>
              <span className="stage-index">{id}</span><span><Icon size={15} style={{ marginRight: 7, verticalAlign: -3 }}/>{label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-note">AI只提出诊断假设。<br/>没有现场验证，不认定真因；没有证据支持，不生成方案。</div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-head no-print">
          <div className="workspace-title"><span className={`badge ${badgeClass(item.status)}`}>{item.status}</span><h1>{item.title}</h1></div>
          <div className="head-actions">
            <span className="badge gray">完成度 {progress}%</span>
            <span className={`save-state ${saveStatus}`}>{saveStatus === "dirty" ? "有未保存修改" : saveStatus === "saving" ? "保存中" : saveStatus === "retrying" ? "保存失败，正在重试" : saveStatus === "failed" ? "保存失败" : "已保存"}</span>
            <button className="btn ghost" onClick={() => void save()} disabled={saving || !dirty}>{saving ? <span className="spinner"/> : <Save size={16}/>}<span className="label">保存</span></button>
          </div>
        </header>
        <div className="content">
          {activeStage === 1 && <ProblemStage item={item} updateField={updateField} update={update} updateStep={updateStep} runDiagnosis={runDiagnosis} issues={issues} running={running} modelOptions={modelOptions} />}
          {activeStage === 2 && <DiagnosisStage item={item} issues={issues} runDiagnosis={runDiagnosis} running={running} updateFinding={updateFinding} goNext={() => setActiveStage(3)} />}
          {activeStage === 3 && <VerificationStage item={item} updateCause={updateCause} generateSolutions={generateSolutions} running={running} />}
          {activeStage === 4 && <ImprovementStage item={item} update={update} updateMeasure={updateMeasure} generateSolutions={generateSolutions} generateToBe={generateToBe} running={running} goNext={() => setActiveStage(5)} />}
          {activeStage === 5 && <ReportStage item={item} copyA3={copyA3} />}
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {draft && <div className="draft-banner"><div><strong>发现未保存的本地草稿</strong><span>可恢复上次异常退出前的内容。</span></div><div><button className="btn ghost" onClick={() => { window.localStorage.removeItem(`qcc-draft:${item.id}`); setDraft(null); }}>忽略</button><button className="btn primary" onClick={() => { update({ ...draft, version: itemRef.current.version }); setDraft(null); }}>恢复草稿</button></div></div>}
    </div>
  );
}

function ProblemStage({ item, updateField, update, updateStep, runDiagnosis, issues, running, modelOptions }: { item: QccCase; updateField: <K extends keyof QccCase>(key: K, value: QccCase[K]) => void; update: (item: QccCase) => void; updateStep: (index: number, key: keyof QccCase["steps"][number], value: ProcessStep[keyof ProcessStep]) => void; runDiagnosis: () => void; issues: string[]; running: string | null; modelOptions: ModelOption[] }) {
  const [section, setSection] = useState<"problem" | "asis" | "facts">("problem");
  const [flowTab, setFlowTab] = useState<"smart" | "drawio" | "table" | "upload">("smart");
  const defaultModel = modelOptions.find((option) => option.id !== "rules")?.id || "rules";
  const selectedModel = item.diagnosisModel || defaultModel;
  const selectedModelOption = modelOptions.find((option) => option.id === selectedModel) || modelOptions[0];
  function commit(next: QccCase) { const stepIds = new Set(next.steps.map((step) => step.id)); const transitionIds = new Set(next.transitions.map((transition) => transition.id)); update({ ...next, steps: next.steps.map((step, index) => ({ ...step, order: index + 1 })), processFacts: next.processFacts.filter((fact) => fact.anchorType === "GLOBAL" || fact.anchorType === "NODE" && stepIds.has(fact.anchorId) || fact.anchorType === "EDGE" && transitionIds.has(fact.anchorId)), asIsDrawio: next.asIsDrawio ? { ...next.asIsDrawio, syncStatus: "STALE" } : null, toBeDrawio: next.toBeDrawio ? { ...next.toBeDrawio, syncStatus: "STALE" } : null, diagnosisStale: next.findings.length > 0 }); }
  function applyTemplate(kind: "order" | "quality" | "purchase" | "production" | "customer" | "blank") {
    if (!window.confirm("应用模板将替换当前AS IS节点与连线，是否继续？")) return;
    const templates = {
      order: [["流程开始", "", "START"], ["接收订单", "销售专员", "ACTION"], ["跨部门评审", "评审负责人", "ACTION"], ["排产与交付", "计划主管", "ACTION"], ["反馈结果", "客服专员", "ACTION"], ["流程结束", "", "END"]],
      quality: [["流程开始", "", "START"], ["发现异常", "现场人员", "ACTION"], ["隔离与上报", "班组长", "ACTION"], ["原因分析", "质量工程师", "ACTION"], ["验证关闭", "流程负责人", "ACTION"], ["流程结束", "", "END"]],
      purchase: [["流程开始", "", "START"], ["提出采购需求", "需求部门", "ACTION"], ["询价与评审", "采购专员", "ACTION"], ["供应商交付", "供应商管理员", "ACTION"], ["验收入库", "仓储专员", "ACTION"], ["流程结束", "", "END"]],
      production: [["流程开始", "", "START"], ["发现生产异常", "操作员", "ACTION"], ["临时处置", "班组长", "ACTION"], ["升级与决策", "生产经理", "ACTION"], ["验证与复盘", "工艺工程师", "ACTION"], ["流程结束", "", "END"]],
      customer: [["流程开始", "", "START"], ["受理客诉", "客服专员", "ACTION"], ["调查分析", "质量工程师", "ACTION"], ["制定对策", "责任部门", "ACTION"], ["客户反馈与关闭", "客服经理", "ACTION"], ["流程结束", "", "END"]],
      blank: [["流程开始", "", "START"], ["新步骤", "", "ACTION"], ["流程结束", "", "END"]],
    } as const;
    const specs = templates[kind];
    const steps = specs.map(([name, owner, nodeType], index) => ({ ...emptyStep(index + 1), id: makeId("step"), name, owner, lane: owner, nodeType, routingMode: "SPECIFIED" as const, input: nodeType === "ACTION" ? "上一步输出" : "", activity: nodeType === "ACTION" ? name : "", output: nodeType === "ACTION" ? `${name}结果` : "", standard: nodeType === "ACTION" ? "按规定时限完成" : "", positionX: 80 + index * 200, positionY: 120 }));
    const transitions = steps.slice(0, -1).map((step, index) => ({ id: makeId("transition"), sourceNodeId: step.id, targetNodeId: steps[index + 1].id, transitionType: "DEFAULT" as const, branchName: "", conditionExpression: "", isDefault: true, order: 1 }));
    commit({ ...item, steps, transitions, processFacts: [] });
  }
  return <>
    <div className="foundation-tabs"><button className={section === "problem" ? "active" : ""} onClick={() => setSection("problem")}>1. 流程界定</button><button className={section === "asis" ? "active" : ""} onClick={() => setSection("asis")}>2. AS IS还原</button><button className={section === "facts" ? "active" : ""} onClick={() => setSection("facts")}>3. 流程问题分析</button></div>
    {section === "problem" && <><div className="step-intro"><div><h2>流程界定</h2><p>先统一课题、流程边界与指标口径，再还原当下真实流程。</p></div></div><section className="panel">
      <div className="panel-title"><div><h3>课题与问题事实</h3><p>建议使用“对象 + 地点 + 时间 + 现象 + 差距 + 影响”的表达。</p></div></div>
      <div className="form-grid">
        <Field label="课题名称" value={item.title} onChange={(v) => updateField("title", v)} placeholder="例如：降低换线首件不良率" />
        <div className="field"><label>问题类型</label><select value={item.problemType} onChange={(e) => updateField("problemType", e.target.value as QccCase["problemType"])}>{problemTypes.map((t) => <option key={t}>{t}</option>)}</select></div>
        <Field label="问题对象" value={item.object} onChange={(v) => updateField("object", v)} placeholder="哪些产品、订单、物料或流程实例" />
        <Field label="发生地点/环节" value={item.location} onChange={(v) => updateField("location", v)} placeholder="车间、产线或跨部门流程" />
        <Field label="统计时间范围" value={item.period} onChange={(v) => updateField("period", v)} placeholder="例如：近3个月" />
        <Field label="频次或差距" value={item.frequency} onChange={(v) => updateField("frequency", v)} placeholder="例如：每周12次，当前8.6%" />
        <Field label="经营影响" value={item.impact} onChange={(v) => updateField("impact", v)} placeholder="返工、停线、延期、资金或客户影响" full textarea />
      </div>
    </section><section className="panel">
      <div className="panel-title"><div><h3>指标与流程边界</h3><p>改善前后必须使用同一统计口径。</p></div></div>
      <div className="form-grid three">
        <Field label="核心指标" value={item.metric} onChange={(v) => updateField("metric", v)} placeholder="首件不良率" />
        <Field label="基线值" value={item.baseline} onChange={(v) => updateField("baseline", v)} placeholder="8.6%" />
        <Field label="目标值" value={item.target} onChange={(v) => updateField("target", v)} placeholder="≤3.0%" />
        <Field label="统计口径" value={item.dataDefinition} onChange={(v) => updateField("dataDefinition", v)} placeholder="分子、分母、范围、时间" full textarea />
        <Field label="流程起点" value={item.processStart} onChange={(v) => updateField("processStart", v)} />
        <Field label="流程终点" value={item.processEnd} onChange={(v) => updateField("processEnd", v)} />
        <Field label="流程责任人" value={item.processOwner} onChange={(v) => updateField("processOwner", v)} />
      </div>
    </section><button className="btn primary" onClick={() => setSection("asis")}>下一步：还原AS IS流程</button></>}
    {section === "asis" && <><div className="step-intro"><div><h2>AS IS流程还原</h2><p>普通流程使用智能搭建，复杂流程可切换到draw.io自由绘制。</p></div></div><section className="panel"><div className="flow-tabs"><button className={flowTab === "smart" ? "active" : ""} onClick={() => setFlowTab("smart")}>智能流程搭建</button><button className={flowTab === "drawio" ? "active" : ""} onClick={() => setFlowTab("drawio")}>draw.io自由绘制</button><button className={flowTab === "table" ? "active" : ""} onClick={() => setFlowTab("table")}>流程明细</button><button className={flowTab === "upload" ? "active" : ""} onClick={() => setFlowTab("upload")}>上传流程图</button></div>{flowTab === "smart" && <><div className="template-bar"><strong>流程模板</strong><button onClick={() => applyTemplate("order")}>订单履约</button><button onClick={() => applyTemplate("quality")}>质量异常</button><button onClick={() => applyTemplate("purchase")}>采购供应商</button><button onClick={() => applyTemplate("production")}>生产异常</button><button onClick={() => applyTemplate("customer")}>客诉处理</button><button onClick={() => applyTemplate("blank")}>空白流程</button><span>应用模板会替换当前流程并清空已有事实。</span></div><ProcessCanvas steps={item.steps} transitions={item.transitions} facts={item.processFacts} onChange={(steps, transitions) => commit({ ...item, steps, transitions })}/></>} {flowTab === "drawio" && <DrawioWorkbench item={item} stage="AS_IS" update={update}/>} {flowTab === "upload" && <UploadSimulator onUseCurrent={() => setFlowTab("smart")} onApply={(steps, transitions) => { if ((item.processFacts.length > 0 || item.findings.length > 0) && !window.confirm(`当前课题已有${item.processFacts.length}条流程问题事实和${item.findings.length}条诊断结论。应用新流程会清除旧事实，并将既有诊断标记为需要重新诊断，是否继续？`)) return; commit({ ...item, steps, transitions, processFacts: [] }); setFlowTab("smart"); }}/>} {flowTab === "table" && <div style={{ overflowX: "auto" }}><table className="step-table"><thead><tr><th>#</th><th>步骤</th><th>节点类型</th><th>主责</th><th>输入</th><th>实际活动</th><th>输出</th><th>标准/时限</th></tr></thead><tbody>{item.steps.map((step, index) => <tr key={step.id}><td>{index + 1}</td><td><input value={step.name} onChange={(event) => updateStep(index, "name", event.target.value)}/></td><td>{step.nodeType === "START" ? "开始" : step.nodeType === "DECISION" ? "判断" : step.nodeType === "END" ? "结束" : "步骤"}</td>{(["owner", "input", "activity", "output", "standard"] as const).map((key) => <td key={key}><input disabled={step.nodeType === "START" || step.nodeType === "END"} value={step[key]} onChange={(event) => updateStep(index, key, event.target.value)}/></td>)}</tr>)}</tbody></table></div>}</section>{processIssues(item).length > 0 && <div className="flow-warnings">{processIssues(item).map((issue, index) => <span key={`${index}-${issue}`}>⚠ {issue}</span>)}</div>}<button className="btn primary" onClick={() => setSection("facts")}>下一步：标注异常事实</button></>}
    {section === "facts" && <><div className="step-intro"><div><h2>流程问题分析</h2><p>支持人工添加，也可从Word、Excel和PDF材料中提取候选问题；分类与流程定位分别记录。</p></div></div><section className="panel"><GuidedFactsPanel item={item} update={update}/></section></>}
    <div className={`callout ${issues.length ? "warn" : "success"}`}><ShieldAlert size={19}/><div><strong>{issues.length ? `诊断前还需补充${issues.length}项` : "信息完整，可以开始诊断"}</strong>{issues.length > 0 && <ul className="issues">{issues.map((x, index) => <li key={`${index}-${x}`}>{x}</li>)}</ul>}</div></div>
    <label className="callout info" style={{ cursor: "pointer" }}><input type="checkbox" checked={item.sanitizedConfirmed} onChange={(e) => updateField("sanitizedConfirmed", e.target.checked)} /><div><strong>我确认资料已经脱敏</strong><br/>不包含客户名称、人员姓名、合同编号或其他敏感数据。</div></label>
    <div className="model-picker"><div><label htmlFor="diagnosis-model">诊断模型</label><p>{selectedModelOption?.description}</p></div><select id="diagnosis-model" value={selectedModel} onChange={(event) => updateField("diagnosisModel", event.target.value)} disabled={running === "diagnose"}>{modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
    <button className="btn blue" disabled={issues.length > 0 || running === "diagnose"} onClick={runDiagnosis}>{running === "diagnose" ? <span className="spinner"/> : <Sparkles size={17}/>}开始现状诊断</button>
  </>;
}

function transitionSummary(item: QccCase, step: ProcessStep) {
  const outgoing = item.transitions.filter((transition) => transition.sourceNodeId === step.id).sort((a, b) => a.order - b.order);
  if (!outgoing.length) return "未配置";
  if (step.nodeType === "DECISION") return outgoing.length <= 2 ? outgoing.map((transition) => `${transition.branchName || "分支"}→${item.steps.find((target) => target.id === transition.targetNodeId)?.name || "?"}`).join("；") : `已配置${outgoing.length}个分支`;
  const target = item.steps.find((candidate) => candidate.id === outgoing[0].targetNodeId);
  return `${step.routingMode === "AUTO_NEXT" ? "自动" : "指定"}→${target?.name || "未配置"}`;
}

function TransitionDrawer({ item, stepId, update, close }: { item: QccCase; stepId: string; update: (item: QccCase) => void; close: () => void }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [close]);
  const step = item.steps.find((candidate) => candidate.id === stepId);
  if (!step) return null;
  const outgoing = item.transitions.filter((transition) => transition.sourceNodeId === stepId).sort((a, b) => a.order - b.order);
  const targets = item.steps.filter((candidate) => candidate.id !== stepId);
  function replaceOutgoing(nextOutgoing: ProcessTransition[], stepPatch?: Partial<ProcessStep>) {
    update({ ...item, steps: item.steps.map((candidate) => candidate.id === stepId ? { ...candidate, ...stepPatch } : candidate), transitions: [...item.transitions.filter((transition) => transition.sourceNodeId !== stepId), ...nextOutgoing] });
  }
  function updateBranch(id: string, patch: Partial<ProcessTransition>) {
    replaceOutgoing(outgoing.map((transition) => transition.id === id ? { ...transition, ...patch } : patch.isDefault ? { ...transition, isDefault: false } : transition));
  }
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside className="transition-drawer" role="dialog" aria-modal="true" aria-label="配置流转关系">
      <div className="drawer-head"><div><h3>配置流转关系</h3><p>{step.name || `步骤${step.order}`}</p></div><button className="icon-btn" onClick={close}><X size={18}/></button></div>
      {step.nodeType === "ACTION" ? <div className="drawer-body">
        <label className="field"><span>流转方式</span><select value={step.routingMode} onChange={(event) => {
          const mode = event.target.value as ProcessStep["routingMode"];
          const index = item.steps.findIndex((candidate) => candidate.id === step.id);
          const target = mode === "AUTO_NEXT" ? item.steps[index + 1] : targets[0];
          replaceOutgoing(target ? [{ id: outgoing[0]?.id || makeId("transition"), sourceNodeId: step.id, targetNodeId: target.id, transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1 }] : [], { routingMode: mode });
        }}><option value="AUTO_NEXT">自动进入下一步骤</option><option value="SPECIFIED">跳转到指定步骤</option></select></label>
        {step.routingMode === "SPECIFIED" && <label className="field"><span>目标步骤</span><select value={outgoing[0]?.targetNodeId || ""} onChange={(event) => replaceOutgoing([{ id: outgoing[0]?.id || makeId("transition"), sourceNodeId: step.id, targetNodeId: event.target.value, transitionType: "DEFAULT", branchName: "", conditionExpression: "", isDefault: true, order: 1 }])}><option value="">请选择</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.order}. {target.name || "未命名步骤"}</option>)}</select></label>}
      </div> : <div className="drawer-body">
        <label className="field"><span>判断名称</span><input value={step.decisionTitle} placeholder="例如：是否满足库存要求？" onChange={(event) => replaceOutgoing(outgoing, { decisionTitle: event.target.value })}/></label>
        <label className="field"><span>判断依据</span><textarea value={step.decisionBasis} placeholder="说明实际判断口径" onChange={(event) => replaceOutgoing(outgoing, { decisionBasis: event.target.value })}/></label>
        <div className="branch-list">{outgoing.map((transition, index) => <div className="branch-card" key={transition.id}>
          <div className="branch-title"><strong>分支 {index + 1}</strong><button className="icon-btn" disabled={outgoing.length <= 2} onClick={() => replaceOutgoing(outgoing.filter((candidate) => candidate.id !== transition.id).map((candidate, order) => ({ ...candidate, order: order + 1 })))}><Trash2 size={14}/></button></div>
          <label className="field"><span>分支名称</span><input value={transition.branchName} onChange={(event) => updateBranch(transition.id, { branchName: event.target.value })}/></label>
          <label className="field"><span>判断条件</span><input value={transition.conditionExpression} onChange={(event) => updateBranch(transition.id, { conditionExpression: event.target.value })}/></label>
          <label className="field"><span>流转至</span><select value={transition.targetNodeId} onChange={(event) => updateBranch(transition.id, { targetNodeId: event.target.value })}>{targets.map((target) => <option key={target.id} value={target.id}>{target.order}. {target.name || "未命名步骤"}</option>)}</select></label>
          <label className="default-branch"><input type="radio" name={`default-${step.id}`} checked={transition.isDefault} onChange={() => updateBranch(transition.id, { isDefault: true })}/>设为默认分支</label>
        </div>)}</div>
        <button className="btn ghost" disabled={outgoing.length >= 6 || !targets.length} onClick={() => replaceOutgoing([...outgoing, { id: makeId("transition"), sourceNodeId: step.id, targetNodeId: targets[0].id, transitionType: "CONDITION", branchName: `分支${outgoing.length + 1}`, conditionExpression: "", isDefault: false, order: outgoing.length + 1 }])}><Plus size={15}/>添加分支</button>
      </div>}
      <div className="drawer-actions"><button className="btn primary" onClick={close}>完成</button></div>
    </aside>
  </div>;
}

function FlowDiagram({ item }: { item: QccCase }) {
  const [zoom, setZoom] = useState(1);
  const width = Math.max(900, item.steps.length * 220 + 120); const height = 380;
  const points = new Map(item.steps.map((step, index) => [step.id, { x: 70 + index * 220, y: 155 }]));
  return <div className="diagram-shell"><div className="diagram-tools"><button onClick={() => setZoom((value) => Math.min(1.5, value + .1))}><ZoomIn size={16}/></button><button onClick={() => setZoom((value) => Math.max(.6, value - .1))}><ZoomOut size={16}/></button><button onClick={() => setZoom(1)}>适应画布</button></div><div className="diagram-scroll"><svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`}>
    <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#55708f"/></marker></defs>
    {item.transitions.map((transition) => { const source = points.get(transition.sourceNodeId); const target = points.get(transition.targetNodeId); if (!source || !target) return null; const back = target.x <= source.x; const path = back ? `M ${source.x + 150} ${source.y + 35} C ${source.x + 180} 70, ${target.x - 30} 70, ${target.x} ${target.y + 35}` : `M ${source.x + 150} ${source.y + 35} L ${target.x} ${target.y + 35}`; return <g key={transition.id}><path d={path} fill="none" stroke="#55708f" strokeWidth="2" markerEnd="url(#arrow)"/><text x={(source.x + target.x + 150) / 2} y={back ? 62 : source.y + 25} textAnchor="middle" className="edge-label">{transition.branchName}</text></g>; })}
    {item.steps.map((step) => { const point = points.get(step.id)!; const label = step.nodeType === "DECISION" ? step.decisionTitle || step.name : step.name; return <g key={step.id}>{step.nodeType === "DECISION" ? <polygon points={`${point.x + 75},${point.y} ${point.x + 150},${point.y + 35} ${point.x + 75},${point.y + 70} ${point.x},${point.y + 35}`} className="node decision"/> : <rect x={point.x} y={point.y} width="150" height="70" rx={step.nodeType === "END" ? 32 : 10} className={`node ${step.nodeType.toLowerCase()}`}/>}<text x={point.x + 75} y={point.y + 31} textAnchor="middle" className="node-label"><tspan x={point.x + 75}>{label.slice(0, 12) || "未命名步骤"}</tspan>{label.length > 12 && <tspan x={point.x + 75} dy="18">{label.slice(12, 24)}</tspan>}</text></g>; })}
  </svg></div></div>;
}

function DiagnosisStage({ item, issues, runDiagnosis, running, updateFinding, goNext }: { item: QccCase; issues: string[]; runDiagnosis: () => void; running: string | null; updateFinding: (index: number, patch: Partial<ProcessFinding>) => void; goNext: () => void }) {
  const [scope, setScope] = useState<"总览" | "组织" | "端到端流程" | "IT" | "规则">("总览");
  const visibleFindings = scope === "总览" ? item.findings : item.findings.filter((finding) => finding.dimension === scope);
  const dimensionLabel = (dimension: "总览" | "组织" | "端到端流程" | "IT" | "规则") => dimension === "规则" ? "管理规则" : dimension;
  return <><div className="step-intro"><div><h2>现状诊断</h2><p>围绕组织、端到端流程、IT、规则四个维度识别问题，并追溯到流程位置与事实。</p></div>{item.engine && <span className="badge blue">{item.engine}</span>}</div>
    <div className="diagnosis-inputs"><div className="diagnosis-input-card"><h4>AS IS流程结构</h4><p>{item.steps.length}个节点、{item.transitions.length}条连线；分析责任、输入输出、判断分支、交接、回流、标准与控制点。</p></div><div className="diagnosis-plus">＋</div><div className="diagnosis-input-card"><h4>流程问题分析</h4><p>{item.processFacts.length}项问题事实；分析组织、流程、IT、管理规则分类以及频次、影响、证据和关联位置。</p></div></div>
    {item.diagnosisStale && <div className="callout warn"><AlertTriangle size={18}/><div><strong>AS IS流程已变化，需要重新诊断</strong><br/>旧断点和原因暂时保留用于对照，重新诊断前不应作为当前流程结论。<div style={{ marginTop: 10 }}><button className="btn blue" disabled={issues.length > 0 || running === "diagnose"} onClick={runDiagnosis}>{running === "diagnose" ? <span className="spinner"/> : <Sparkles size={15}/>}重新诊断当前流程</button></div></div></div>}
    {!item.findings.length ? <div className="panel empty"><div className="empty-icon"><FileSearch/></div><h3>尚未形成诊断结果</h3><p>{issues.length ? "请先返回补充问题和流程信息。" : "信息已就绪，可以开始诊断。"}</p><button className="btn blue" disabled={issues.length > 0 || running === "diagnose"} onClick={runDiagnosis}>{running ? <span className="spinner"/> : <Sparkles size={16}/>}生成诊断</button></div> : <>
      <div className="diagnosis-summary">{(["组织", "端到端流程", "IT", "规则"] as const).map((dimension) => <button key={dimension} onClick={() => setScope(dimension)}><strong>{item.findings.filter((finding) => finding.dimension === dimension).length}</strong><span>{dimensionLabel(dimension)}</span><small>{item.findings.filter((finding) => finding.dimension === dimension && finding.priority === "高").length}项高优先</small></button>)}</div>
      <div className="callout info"><ShieldAlert size={18}/><div><strong>诊断结论仍是待验证判断</strong><br/>每一项引用流程步骤、缺失字段或问题事实；进入根因验证后才判断是否成立。</div></div>
      <div className="result-filter">{(["总览", "组织", "端到端流程", "IT", "规则"] as const).map((dimension) => <button key={dimension} className={scope === dimension ? "active" : ""} onClick={() => setScope(dimension)}>{dimensionLabel(dimension)}（{dimension === "总览" ? item.findings.length : item.findings.filter((finding) => finding.dimension === dimension).length}）</button>)}</div>
      <div className="finding-list">{visibleFindings.map((finding) => { const index = item.findings.findIndex((value) => value.id === finding.id); const evidenceLevel = finding.evidenceLevel || (finding.factIds?.length ? "事实支持" : "仅流程结构"); return <article className="finding-card" key={finding.id}><div className="finding-head"><div><h4>{finding.stepName}｜{finding.title}</h4><div className="meta-line"><span className="badge blue">{finding.dimension === "规则" ? "管理规则" : finding.dimension}</span><span className="badge gray">{finding.problemTag || finding.category}</span><span className={`badge ${badgeClass(finding.priority)}`}>{finding.priority}优先</span><span>{finding.anchorType === "EDGE" ? "交接定位" : finding.anchorType === "GLOBAL" ? "全流程定位" : "节点定位"}</span><span className={`badge ${evidenceLevel === "待补证" || evidenceLevel === "仅流程结构" ? "gray" : "green"}`}>{evidenceLevel}</span><span>信息完整度 {finding.completeness}%</span>{finding.userEdited && <span>已人工修改</span>}</div></div><select className="status-select" value={finding.priority} onChange={(e) => updateFinding(index, { priority: e.target.value as ProcessFinding["priority"] })}><option>高</option><option>中</option><option>低</option></select></div><div className="evidence">依据：{finding.evidence}</div><div className="card-grid"><Field label="诊断结论" value={finding.title} onChange={(v) => updateFinding(index, { title: v })}/><Field label="需要进一步确认" value={finding.question} onChange={(v) => updateFinding(index, { question: v })}/></div></article>; })}</div>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}><button className="btn ghost" onClick={runDiagnosis} disabled={running === "diagnose"}><Sparkles size={16}/>补充诊断</button><button className="btn primary" onClick={goNext}>进入根因验证</button></div>
    </>}
  </>;
}

function VerificationStage({ item, updateCause, generateSolutions, running }: { item: QccCase; updateCause: (index: number, patch: Partial<CauseHypothesis>) => void; generateSolutions: () => void; running: string | null }) {
  const supported = item.hypotheses.filter((h) => h.status === "证据支持").length;
  const [filter, setFilter] = useState<"全部" | CauseHypothesis["status"]>("全部");
  const visible = filter === "全部" ? item.hypotheses : item.hypotheses.filter((cause) => cause.status === filter);
  const groups = [...new Set(visible.map((cause) => cause.stepName))];
  return <><div className="step-intro"><div><h2>原因假设与验证</h2><p>鱼骨图和AI只能提出假设；现场数据、观察或试验才有资格支持真因。</p></div><span className="badge green">{supported} 个证据支持</span></div>
    {!item.hypotheses.length ? <div className="panel empty"><div className="empty-icon"><ShieldAlert/></div><h3>请先完成流程断点诊断</h3></div> : <>
      <div className="callout warn"><ShieldAlert size={18}/><div><strong>验证纪律</strong><br/>必须先填写验证结果，才能选择“证据支持”。证据不足的原因不会进入方案生成。</div></div>
      <div className="verification-progress"><strong>验证进度</strong><span>{item.hypotheses.filter((cause) => cause.status !== "待验证").length}/{item.hypotheses.length} 已判定</span><progress max={item.hypotheses.length} value={item.hypotheses.filter((cause) => cause.status !== "待验证").length}/></div>
      <div className="result-filter">{(["全部", "待验证", "证据支持", "证据不足", "证据不支持"] as const).map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status}（{status === "全部" ? item.hypotheses.length : item.hypotheses.filter((cause) => cause.status === status).length}）</button>)}</div>
      <div className="cause-groups">{groups.map((stepName) => <details key={stepName} open={filter !== "全部" || visible.filter((cause) => cause.stepName === stepName).some((cause) => cause.status === "证据支持")}><summary><strong>{stepName}</strong><span>{visible.filter((cause) => cause.stepName === stepName).length}个原因假设</span></summary><div className="cause-list">{visible.filter((cause) => cause.stepName === stepName).map((cause) => { const index = item.hypotheses.findIndex((value) => value.id === cause.id); const overdue = Boolean(cause.dueDate && cause.status === "待验证" && new Date(`${cause.dueDate}T23:59:59`).getTime() < Date.now()); return <article className="cause-card" key={cause.id}><div className="cause-head"><div><h4>{cause.statement}</h4><div className="meta-line"><span className={`badge ${cause.kind === "机制原因" ? "blue" : "gray"}`}>{cause.kind}</span><span>{cause.verificationMethod}</span>{overdue && <span className="badge red">已逾期</span>}{cause.userEdited && <span>已人工修改</span>}</div></div><select className={`status-select ${cause.status === "证据支持" ? "supported" : cause.status === "证据不支持" ? "rejected" : "pending"}`} value={cause.status} onChange={(e) => updateCause(index, { status: e.target.value as CauseHypothesis["status"] })}><option>待验证</option><option>证据支持</option><option>证据不支持</option><option>证据不足</option></select></div><div className="evidence">提出依据：{cause.rationale}</div><div className="card-grid"><Field label="所需数据/样本" value={cause.dataNeeded} onChange={(v) => updateCause(index, { dataNeeded: v })} textarea/><Field label="成立/不成立标准" value={cause.decisionRule} onChange={(v) => updateCause(index, { decisionRule: v })} textarea/><Field label="责任人" value={cause.owner} onChange={(v) => updateCause(index, { owner: v })}/><div className="field"><label>完成日期</label><input type="date" value={cause.dueDate} onChange={(event) => updateCause(index, { dueDate: event.target.value })}/></div><Field label="验证结果与证据" value={cause.result} onChange={(v) => updateCause(index, { result: v })} placeholder="填写数据结果、现场记录或试验结论" full textarea/></div></article>; })}</div></details>)}</div>
      <button className="btn blue" style={{ marginTop: 20 }} disabled={!supported || running === "solutions"} onClick={generateSolutions}>{running === "solutions" ? <span className="spinner"/> : <Sparkles size={17}/>}为已验证原因生成方案</button>
    </>}
  </>;
}

function ImprovementStage({ item, update, updateMeasure, generateSolutions, generateToBe, running, goNext }: { item: QccCase; update: (item: QccCase) => void; updateMeasure: (index: number, patch: Partial<Countermeasure>) => void; generateSolutions: () => void; generateToBe: (mode: "COPY" | "AI", replace?: boolean) => void; running: string | null; goNext: () => void }) {
  const [section, setSection] = useState<"tobe" | "details">(item.countermeasures.length ? "details" : "tobe");
  const previousMeasureCount = useRef(item.countermeasures.length);
  useEffect(() => { if (previousMeasureCount.current === 0 && item.countermeasures.length > 0) setSection("details"); previousMeasureCount.current = item.countermeasures.length; }, [item.countermeasures.length]);
  return <><div className="step-intro"><div><h2>改善方案</h2><p>用TO BE流程呈现未来怎么运行，同时保留原有的详细方案说明。</p></div></div><div className="improvement-tabs"><button className={section === "tobe" ? "active" : ""} onClick={() => setSection("tobe")}><GitBranch size={18}/><span><strong>TO BE流程</strong><small>绘制、对照与追溯流程变更</small></span></button><button className={section === "details" ? "active" : ""} onClick={() => setSection("details")}><Lightbulb size={18}/><span><strong>详细方案说明 {item.countermeasures.length > 0 && <em className="count-dot">{item.countermeasures.length}</em>}</strong><small>实施动作、责任、指标、风险与回退</small></span></button></div>{section === "tobe" ? <section className="panel"><ToBeWorkbench item={item} update={update} generate={generateToBe} running={running === "tobe"}/></section> : <SolutionStage item={item} updateMeasure={updateMeasure} generateSolutions={generateSolutions} running={running} goNext={goNext}/>} {section === "tobe" && <div style={{ marginTop: 18 }}><button className="btn primary" onClick={() => setSection("details")}>查看详细方案说明{item.countermeasures.length ? `（${item.countermeasures.length}项）` : ""}</button></div>}</>;
}

function SolutionStage({ item, updateMeasure, generateSolutions, running, goNext }: { item: QccCase; updateMeasure: (index: number, patch: Partial<Countermeasure>) => void; generateSolutions: () => void; running: string | null; goNext: () => void }) {
  const measures = [...item.countermeasures].sort((a,b) => b.totalScore-a.totalScore);
  return <><div className="step-intro"><div><h2>针对性改善方案</h2><p>每项方案都必须映射到证据支持的原因，并通过试点验证，而不是直接全面实施。</p></div></div>
    {!measures.length ? <div className="panel empty"><div className="empty-icon"><Lightbulb/></div><h3>尚未生成改善方案</h3><p>完成至少一个原因验证后，系统将提供快速改善、流程机制和数字化支持三类方案。</p><button className="btn blue" onClick={generateSolutions} disabled={running === "solutions"}>{running ? <span className="spinner"/> : <Sparkles size={16}/>}生成方案</button></div> : <>
      <div className="measure-list">{measures.map((measure) => { const index = item.countermeasures.findIndex((m) => m.id === measure.id); return <article className="measure-card" key={measure.id}><div className="measure-head"><div><h4>{measure.action}</h4><div className="meta-line"><span className={`badge ${measure.type === "流程机制" ? "blue" : measure.type === "数字化支持" ? "amber" : "green"}`}>{measure.type}</span><span>针对：{measure.cause}</span>{measure.userEdited && <span>已人工修改</span>}</div></div><span className="badge green">优先级 {measure.totalScore}</span></div><div className="card-grid"><Field label="实施动作" value={measure.action} onChange={(v) => updateMeasure(index, { action: v })} full textarea/><Field label="试点范围" value={measure.pilotScope} onChange={(v) => updateMeasure(index, { pilotScope: v })}/><Field label="责任角色" value={measure.ownerRole} onChange={(v) => updateMeasure(index, { ownerRole: v })}/><Field label="成功指标" value={measure.successMetric} onChange={(v) => updateMeasure(index, { successMetric: v })}/><Field label="周期" value={measure.cycle} onChange={(v) => updateMeasure(index, { cycle: v })}/><Field label="风险" value={measure.risk} onChange={(v) => updateMeasure(index, { risk: v })}/><Field label="回退方案" value={measure.rollback} onChange={(v) => updateMeasure(index, { rollback: v })}/></div><div className="score-row">{([['impact','预期效果'],['effort','实施投入'],['speed','落地速度'],['riskScore','实施风险']] as const).map(([key,label]) => <div className="score" key={key}><span>{label}</span><input type="number" min="1" max="5" value={measure[key]} onChange={(e) => updateMeasure(index, { [key]: Number(e.target.value) })}/></div>)}<div className="score"><span>综合分</span><b>{measure.totalScore}</b></div></div></article>; })}</div>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}><button className="btn ghost" onClick={generateSolutions} disabled={running === "solutions"}><Sparkles size={16}/>补充方案</button><button className="btn primary" onClick={goNext}>查看诊断报告</button></div>
    </>}
  </>;
}

function ReportStage({ item, copyA3 }: { item: QccCase; copyA3: () => void }) {
  const supported = item.hypotheses.filter((h) => h.status === "证据支持");
  const highFindings = item.findings.filter((f) => f.priority === "高");
  const categoryCounts = problemCategories.map((category) => ({ category, count: item.processFacts.filter((fact) => fact.problemCategory === category).length }));
  const activeCategories = categoryCounts.filter((entry) => entry.count > 0).length;
  const toBeItem = item.toBeProcess ? { ...item, steps: item.toBeProcess.steps, transitions: item.toBeProcess.transitions, processFacts: [] } : null;
  return <><div className="step-intro no-print"><div><h2>报告与交付</h2><p>导出内容可直接用于QCC辅导、阶段评审和A3更新。</p></div></div>
    <div className="export-actions no-print" style={{ marginBottom: 18 }}><a className="btn blue" href={`/api/cases/${item.id}/export`}><Download size={16}/>下载Excel诊断包</a><button className="btn ghost" onClick={() => window.print()}><Printer size={16}/>打印/保存PDF</button><button className="btn ghost" onClick={copyA3}><Clipboard size={16}/>复制A3文本</button></div>
    <article className="panel report-cover"><div className="report-title"><div><span className="eyebrow">QCC PROCESS DIAGNOSTIC</span><h2>{item.title}</h2><p style={{ color: "var(--muted)", margin: 0 }}>{item.problemType}问题 · {item.processStart} → {item.processEnd}</p></div><span className="badge blue">{item.engine || "尚未诊断"}</span></div>
      <section className="report-section report-block"><div className="report-block-head"><span>01</span><div><h3>问题与流程</h3><p>指标、流程边界与AS IS运行方式</p></div></div><div className="report-summary three"><div className="summary-cell"><span>核心指标</span><strong>{item.metric || "待补充"}</strong><small>口径：{item.dataDefinition || "待补充"}</small></div><div className="summary-cell"><span>基线 → 目标</span><strong>{item.baseline || "-"} → {item.target || "-"}</strong><small>期间：{item.period || "待补充"}</small></div><div className="summary-cell"><span>流程边界</span><strong>{item.processStart || "-"} → {item.processEnd || "-"}</strong><small>责任人：{item.processOwner || "待补充"}</small></div></div><h4>AS IS流程图</h4><FlowDiagram item={item}/></section>
      <section className="report-section report-block"><div className="report-block-head"><span>02</span><div><h3>现状诊断</h3><p>问题分类、主要问题与诊断结论</p></div></div><div className="diagnosis-count-head"><strong>共识别{activeCategories}类、{item.processFacts.length}项问题</strong><span>高优先级诊断{highFindings.length}项</span></div><div className="report-category-grid">{categoryCounts.map(({ category, count }) => <div key={category}><span>{category}</span><strong>{count}项</strong><small>{category === "流程类" ? "流程交接、节点流程、全流程" : category === "管理规则类" ? "策略及规则、制度等" : category === "组织类" ? "职责、权限与协同" : "系统、数据与接口"}</small></div>)}</div><div className="report-conclusions"><div><strong>主要问题</strong><p>{item.processFacts.slice(0, 3).map((fact) => fact.description).join("；") || "尚未记录流程问题。"}</p></div><div><strong>现状诊断结论</strong><p>{highFindings.slice(0, 4).map((finding) => `${finding.dimension}：${finding.title}`).join("；") || "尚未完成现状诊断。"}</p></div><div><strong>业务影响</strong><p>{item.impact || "待补充经营影响。"}</p></div></div></section>
      <section className="report-section report-block"><div className="report-block-head"><span>03</span><div><h3>根因验证</h3><p>仅呈现获得证据支持的原因</p></div></div><div className="diagnosis-count-head"><strong>{item.hypotheses.length}项原因假设中，{supported.length}项获得证据支持</strong><span>{item.hypotheses.filter((cause) => cause.status !== "待验证").length}/{item.hypotheses.length}已判定</span></div><ol className="report-list">{supported.length ? supported.map((cause) => <li key={cause.id}><strong>{cause.kind}｜{cause.stepName}</strong>：{cause.statement}。验证证据：{cause.result}</li>) : <li>尚无原因获得证据支持，当前不应进入方案实施。</li>}</ol></section>
      <section className="report-section report-block"><div className="report-block-head"><span>04</span><div><h3>改善方案</h3><p>TO BE流程及详细方案说明</p></div></div><h4>TO BE流程图</h4>{toBeItem ? <FlowDiagram item={toBeItem}/> : <div className="empty-report-flow">尚未设计TO BE流程。</div>}<div className="report-conclusions"><div><strong>流程变更</strong><p>{item.toBeProcess?.changes.map((change) => `[${change.changeType}] ${change.description}`).join("；") || "尚未形成流程变更。"}</p></div></div><div className="report-measures">{item.countermeasures.length ? [...item.countermeasures].sort((a,b) => b.totalScore-a.totalScore).map((measure) => <article key={measure.id}><div><span className="badge blue">{measure.type}</span><strong>{measure.action}</strong></div><p>试点：{measure.pilotScope}；责任：{measure.ownerRole}；周期：{measure.cycle}</p><p>成功指标：{measure.successMetric}；风险：{measure.risk}；回退：{measure.rollback}</p></article>) : <p>需完成原因验证后生成详细改善方案。</p>}</div></section>
      <div className="callout info" style={{ marginTop: 26, marginBottom: 0 }}><CheckCircle2 size={18}/><div>本报告用于形成诊断假设和试点方案，不替代现场调查、数据验证及辅导员评审。</div></div>
    </article>
  </>;
}
