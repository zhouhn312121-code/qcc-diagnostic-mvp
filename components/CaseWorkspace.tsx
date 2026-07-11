"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpenCheck, CheckCircle2, Clipboard, Download, FileSearch, GitBranch, Lightbulb, Plus, Printer, Save, ShieldAlert, Sparkles, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { caseProgress, emptyStep, hasProcessLoop, processIssues, readinessIssues, syncAutoTransitions } from "@/lib/case-utils";
import { makeId } from "@/lib/ids";
import { problemTypes, type CauseHypothesis, type Countermeasure, type ProcessFinding, type ProcessStep, type ProcessTransition, type QccCase } from "@/lib/types";

const stages = [
  { id: 1, label: "问题与流程", icon: GitBranch },
  { id: 2, label: "断点诊断", icon: FileSearch },
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

export function CaseWorkspace({ initialCase }: { initialCase: QccCase }) {
  const [item, setItem] = useState(initialCase);
  const [activeStage, setActiveStage] = useState(Math.min(initialCase.stage, 5));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "retrying" | "failed">("saved");
  const [draft, setDraft] = useState<QccCase | null>(null);
  const [running, setRunning] = useState<"diagnose" | "solutions" | null>(null);
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
      setItem(data.case); setDirty(false); setActiveStage(2); notify(`诊断完成 · ${data.engine}`);
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
      setItem(data.case); setDirty(false); setActiveStage(4); notify(`方案生成完成 · ${data.engine}`);
    } catch (error) { notify(error instanceof Error ? error.message : "方案生成失败"); }
    finally { setRunning(null); }
  }

  function updateStep(index: number, key: keyof QccCase["steps"][number], value: ProcessStep[keyof ProcessStep]) {
    const steps = [...item.steps]; steps[index] = { ...steps[index], [key]: value }; update({ ...item, steps });
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
    const text = [
      `【课题】${item.title}`, `【问题事实】${item.object}在${item.location}，${item.period}发生${item.frequency}。影响：${item.impact}`,
      `【核心指标】${item.metric}：基线${item.baseline}，目标${item.target}。口径：${item.dataDefinition}`,
      `【流程边界】${item.processStart} → ${item.processEnd}`, `【主要流程断点】\n${item.findings.filter((f) => f.priority === "高").map((f, i) => `${i + 1}. ${f.stepName}｜${f.category}｜${f.title}`).join("\n") || "待完成诊断"}`,
      `【证据支持原因】\n${supported.map((h, i) => `${i + 1}. ${h.statement}；证据：${h.result}`).join("\n") || "尚无"}`,
      `【候选对策】\n${item.countermeasures.sort((a,b) => b.totalScore-a.totalScore).slice(0,6).map((m,i) => `${i+1}. [${m.type}] ${m.action}`).join("\n") || "待生成"}`,
    ].join("\n\n");
    await navigator.clipboard.writeText(text); notify("A3结构化文本已复制");
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
          {activeStage === 1 && <ProblemStage item={item} updateField={updateField} update={update} updateStep={updateStep} runDiagnosis={runDiagnosis} issues={issues} running={running} />}
          {activeStage === 2 && <DiagnosisStage item={item} issues={issues} runDiagnosis={runDiagnosis} running={running} updateFinding={updateFinding} goNext={() => setActiveStage(3)} />}
          {activeStage === 3 && <VerificationStage item={item} updateCause={updateCause} generateSolutions={generateSolutions} running={running} />}
          {activeStage === 4 && <SolutionStage item={item} updateMeasure={updateMeasure} generateSolutions={generateSolutions} running={running} goNext={() => setActiveStage(5)} />}
          {activeStage === 5 && <ReportStage item={item} copyA3={copyA3} />}
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {draft && <div className="draft-banner"><div><strong>发现未保存的本地草稿</strong><span>可恢复上次异常退出前的内容。</span></div><div><button className="btn ghost" onClick={() => { window.localStorage.removeItem(`qcc-draft:${item.id}`); setDraft(null); }}>忽略</button><button className="btn primary" onClick={() => { update({ ...draft, version: itemRef.current.version }); setDraft(null); }}>恢复草稿</button></div></div>}
    </div>
  );
}

function ProblemStage({ item, updateField, update, updateStep, runDiagnosis, issues, running }: { item: QccCase; updateField: <K extends keyof QccCase>(key: K, value: QccCase[K]) => void; update: (item: QccCase) => void; updateStep: (index: number, key: keyof QccCase["steps"][number], value: ProcessStep[keyof ProcessStep]) => void; runDiagnosis: () => void; issues: string[]; running: string | null }) {
  const [flowTab, setFlowTab] = useState<"table" | "diagram">("table");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  function commit(next: QccCase) { update(syncAutoTransitions({ ...next, steps: next.steps.map((step, index) => ({ ...step, order: index + 1 })) })); }
  function changeNodeType(index: number, nodeType: ProcessStep["nodeType"]) {
    const steps = [...item.steps]; const step = steps[index];
    steps[index] = { ...step, nodeType, routingMode: nodeType === "ACTION" ? "AUTO_NEXT" : "SPECIFIED" };
    let transitions = item.transitions.filter((transition) => transition.sourceNodeId !== step.id);
    if (nodeType === "DECISION") {
      const target = steps[index + 1]?.id || steps.find((candidate) => candidate.nodeType === "END")?.id;
      if (target) transitions = [
        ...transitions,
        { id: makeId("transition"), sourceNodeId: step.id, targetNodeId: target, transitionType: "CONDITION", branchName: "是", conditionExpression: "", isDefault: false, order: 1 },
        { id: makeId("transition"), sourceNodeId: step.id, targetNodeId: target, transitionType: "CONDITION", branchName: "否", conditionExpression: "", isDefault: true, order: 2 },
      ];
      setEditingStepId(step.id);
    }
    commit({ ...item, steps, transitions });
  }
  function addStep() {
    if (item.steps.length >= 20) return;
    const endIndex = item.steps.findIndex((step) => step.nodeType === "END");
    const insertAt = endIndex < 0 ? item.steps.length : endIndex;
    const steps = [...item.steps]; steps.splice(insertAt, 0, emptyStep(insertAt + 1)); commit({ ...item, steps });
  }
  function deleteStep(step: ProcessStep) {
    const incoming = item.transitions.filter((transition) => transition.targetNodeId === step.id);
    if (incoming.length) { window.alert(`该步骤正被${incoming.length}条流转引用，请先修改相关流转。`); return; }
    commit({ ...item, steps: item.steps.filter((candidate) => candidate.id !== step.id), transitions: item.transitions.filter((transition) => transition.sourceNodeId !== step.id) });
  }
  return <>
    <div className="step-intro"><div><h2>定义问题与流程</h2><p>先把问题讲清楚，再让系统检查流程。缺少量化事实时，诊断不会启动。</p></div></div>
    <section className="panel">
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
    </section>
    <section className="panel">
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
    </section>
    <section className="panel">
      <div className="panel-title"><div><h3>AS IS关键流程步骤</h3><p>填写实际做法；判断节点可配置条件分支和回流。最多20个节点。</p></div><button className="btn ghost" disabled={item.steps.length >= 20} onClick={addStep}><Plus size={15}/>增加步骤</button></div>
      <div className="flow-tabs"><button className={flowTab === "table" ? "active" : ""} onClick={() => setFlowTab("table")}>步骤信息录入</button><button className={flowTab === "diagram" ? "active" : ""} onClick={() => setFlowTab("diagram")}>流程图预览</button></div>
      {flowTab === "table" ? <div style={{ overflowX: "auto" }}><table className="step-table"><thead><tr><th className="narrow">#</th><th>步骤</th><th>节点类型</th><th>主责</th><th>输入</th><th>实际活动</th><th>输出</th><th>标准/时限</th><th>异常事实</th><th>流转关系</th><th></th></tr></thead><tbody>
        {item.steps.map((step, index) => <tr key={step.id} className={step.nodeType === "END" ? "end-row" : ""}><td className="narrow"><div className="order-tools"><span>{index + 1}</span><button disabled={index === 0} onClick={() => { const steps = [...item.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; commit({ ...item, steps }); }}>↑</button><button disabled={index === item.steps.length - 1} onClick={() => { const steps = [...item.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; commit({ ...item, steps }); }}>↓</button></div></td>
          <td><input value={step.name} onChange={(e) => updateStep(index, "name", e.target.value)} /></td>
          <td><select value={step.nodeType} onChange={(e) => changeNodeType(index, e.target.value as ProcessStep["nodeType"])}><option value="ACTION">普通步骤</option><option value="DECISION">判断节点</option><option value="END">结束节点</option></select></td>
          {(["owner","input","activity","output","standard","anomaly"] as const).map((key) => <td key={key}><input disabled={step.nodeType === "END" && !["output","anomaly"].includes(key)} value={step[key]} onChange={(e) => updateStep(index, key, e.target.value)} placeholder={key === "activity" ? "实际怎么做" : ""}/></td>)}
          <td><button className="route-summary" disabled={step.nodeType === "END"} onClick={() => setEditingStepId(step.id)}>{transitionSummary(item, step)}</button></td>
          <td><button aria-label="删除步骤" className="icon-btn" disabled={item.steps.length <= 2} onClick={() => deleteStep(step)}><Trash2 size={14}/></button></td></tr>)}
      </tbody></table></div> : <FlowDiagram item={item} />}
      {processIssues(item).length > 0 && <div className="flow-warnings">{processIssues(item).map((issue) => <span key={issue}>⚠ {issue}</span>)}</div>}
      {hasProcessLoop(item) && <div className="flow-warnings"><span>↩ 检测到流程回流，请确认该循环符合实际业务。</span></div>}
    </section>
    {editingStepId && <TransitionDrawer item={item} stepId={editingStepId} update={commit} close={() => setEditingStepId(null)} />}
    <div className={`callout ${issues.length ? "warn" : "success"}`}><ShieldAlert size={19}/><div><strong>{issues.length ? `诊断前还需补充${issues.length}项` : "信息完整，可以开始诊断"}</strong>{issues.length > 0 && <ul className="issues">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}</div></div>
    <label className="callout info" style={{ cursor: "pointer" }}><input type="checkbox" checked={item.sanitizedConfirmed} onChange={(e) => updateField("sanitizedConfirmed", e.target.checked)} /><div><strong>我确认资料已经脱敏</strong><br/>不包含客户名称、人员姓名、合同编号或其他敏感数据。</div></label>
    <button className="btn blue" disabled={issues.length > 0 || running === "diagnose"} onClick={runDiagnosis}>{running === "diagnose" ? <span className="spinner"/> : <Sparkles size={17}/>}开始流程断点诊断</button>
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
  return <><div className="step-intro"><div><h2>流程断点诊断</h2><p>按照责任、交接、规则、控制、数据和异常闭环六类机制扫描。</p></div>{item.engine && <span className="badge blue">{item.engine}</span>}</div>
    {!item.findings.length ? <div className="panel empty"><div className="empty-icon"><FileSearch/></div><h3>尚未形成诊断结果</h3><p>{issues.length ? "请先返回补充问题和流程信息。" : "信息已就绪，可以开始诊断。"}</p><button className="btn blue" disabled={issues.length > 0 || running === "diagnose"} onClick={runDiagnosis}>{running ? <span className="spinner"/> : <Sparkles size={16}/>}生成诊断</button></div> : <>
      <div className="callout info"><ShieldAlert size={18}/><div><strong>断点是待验证的诊断判断</strong><br/>每一项都引用了流程步骤或缺失信息。你可以直接修改，修改后的内容不会被后续生成覆盖。</div></div>
      <div className="finding-list">{item.findings.map((finding, index) => <article className="finding-card" key={finding.id}><div className="finding-head"><div><h4>{finding.stepName}｜{finding.title}</h4><div className="meta-line"><span className="badge blue">{finding.category}</span><span className={`badge ${badgeClass(finding.priority)}`}>{finding.priority}优先</span><span>信息完整度 {finding.completeness}%</span>{finding.userEdited && <span>已人工修改</span>}</div></div><select className="status-select" value={finding.priority} onChange={(e) => updateFinding(index, { priority: e.target.value as ProcessFinding["priority"] })}><option>高</option><option>中</option><option>低</option></select></div><div className="evidence">依据：{finding.evidence}</div><div className="card-grid"><Field label="诊断结论" value={finding.title} onChange={(v) => updateFinding(index, { title: v })}/><Field label="需要进一步确认" value={finding.question} onChange={(v) => updateFinding(index, { question: v })}/></div></article>)}</div>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}><button className="btn ghost" onClick={runDiagnosis} disabled={running === "diagnose"}><Sparkles size={16}/>补充诊断</button><button className="btn primary" onClick={goNext}>进入根因验证</button></div>
    </>}
  </>;
}

function VerificationStage({ item, updateCause, generateSolutions, running }: { item: QccCase; updateCause: (index: number, patch: Partial<CauseHypothesis>) => void; generateSolutions: () => void; running: string | null }) {
  const supported = item.hypotheses.filter((h) => h.status === "证据支持").length;
  return <><div className="step-intro"><div><h2>原因假设与验证</h2><p>鱼骨图和AI只能提出假设；现场数据、观察或试验才有资格支持真因。</p></div><span className="badge green">{supported} 个证据支持</span></div>
    {!item.hypotheses.length ? <div className="panel empty"><div className="empty-icon"><ShieldAlert/></div><h3>请先完成流程断点诊断</h3></div> : <>
      <div className="callout warn"><ShieldAlert size={18}/><div><strong>验证纪律</strong><br/>必须先填写验证结果，才能选择“证据支持”。证据不足的原因不会进入方案生成。</div></div>
      <div className="cause-list">{item.hypotheses.map((cause, index) => <article className="cause-card" key={cause.id}><div className="cause-head"><div><h4>{cause.statement}</h4><div className="meta-line"><span className={`badge ${cause.kind === "机制原因" ? "blue" : "gray"}`}>{cause.kind}</span><span>{cause.stepName}</span><span>{cause.verificationMethod}</span>{cause.userEdited && <span>已人工修改</span>}</div></div><select className={`status-select ${cause.status === "证据支持" ? "supported" : cause.status === "证据不支持" ? "rejected" : "pending"}`} value={cause.status} onChange={(e) => updateCause(index, { status: e.target.value as CauseHypothesis["status"] })}><option>待验证</option><option>证据支持</option><option>证据不支持</option><option>证据不足</option></select></div><div className="evidence">提出依据：{cause.rationale}</div><div className="card-grid"><Field label="所需数据/样本" value={cause.dataNeeded} onChange={(v) => updateCause(index, { dataNeeded: v })} textarea/><Field label="成立/不成立标准" value={cause.decisionRule} onChange={(v) => updateCause(index, { decisionRule: v })} textarea/><Field label="责任人" value={cause.owner} onChange={(v) => updateCause(index, { owner: v })}/><Field label="完成日期" value={cause.dueDate} onChange={(v) => updateCause(index, { dueDate: v })} placeholder="YYYY-MM-DD"/><Field label="验证结果与证据" value={cause.result} onChange={(v) => updateCause(index, { result: v })} placeholder="填写数据结果、现场记录或试验结论" full textarea/></div></article>)}</div>
      <button className="btn blue" style={{ marginTop: 20 }} disabled={!supported || running === "solutions"} onClick={generateSolutions}>{running === "solutions" ? <span className="spinner"/> : <Sparkles size={17}/>}为已验证原因生成方案</button>
    </>}
  </>;
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
  return <><div className="step-intro no-print"><div><h2>报告与交付</h2><p>导出内容可直接用于QCC辅导、阶段评审和A3更新。</p></div></div>
    <div className="export-actions no-print" style={{ marginBottom: 18 }}><a className="btn blue" href={`/api/cases/${item.id}/export`}><Download size={16}/>下载Excel诊断包</a><button className="btn ghost" onClick={() => window.print()}><Printer size={16}/>打印/保存PDF</button><button className="btn ghost" onClick={copyA3}><Clipboard size={16}/>复制A3文本</button></div>
    <article className="panel report-cover"><div className="report-title"><div><span className="eyebrow">QCC PROCESS DIAGNOSTIC</span><h2>{item.title}</h2><p style={{ color: "var(--muted)", margin: 0 }}>{item.problemType}问题 · {item.processStart} → {item.processEnd}</p></div><span className="badge blue">{item.engine || "尚未诊断"}</span></div>
      <div className="report-summary"><div className="summary-cell"><span>核心指标</span><strong>{item.metric || "待补充"}</strong></div><div className="summary-cell"><span>基线 → 目标</span><strong>{item.baseline || "-"} → {item.target || "-"}</strong></div><div className="summary-cell"><span>流程断点</span><strong>{item.findings.length}项</strong></div><div className="summary-cell"><span>证据支持原因</span><strong>{supported.length}项</strong></div></div>
      <section className="report-section"><h3>问题事实</h3><p>{item.object}在{item.location}，{item.period}发生{item.frequency}。造成的经营影响为：{item.impact}。</p><p style={{ color: "var(--muted)" }}>统计口径：{item.dataDefinition}</p></section>
      <section className="report-section"><h3>高优先级流程断点</h3><ol className="report-list">{highFindings.length ? highFindings.map((f) => <li key={f.id}><strong>{f.stepName}｜{f.category}</strong>：{f.title}。{f.question}</li>) : <li>尚未完成断点诊断。</li>}</ol></section>
      <section className="report-section"><h3>证据支持的原因</h3><ol className="report-list">{supported.length ? supported.map((h) => <li key={h.id}><strong>{h.kind}</strong>：{h.statement}。验证证据：{h.result}</li>) : <li>尚无原因获得证据支持，当前不应进入方案实施。</li>}</ol></section>
      <section className="report-section"><h3>优先改善方案</h3><ol className="report-list">{item.countermeasures.length ? [...item.countermeasures].sort((a,b) => b.totalScore-a.totalScore).slice(0,6).map((m) => <li key={m.id}><strong>[{m.type}｜{m.totalScore}分]</strong> {m.action}；试点：{m.pilotScope}；成功标准：{m.successMetric}。</li>) : <li>需完成原因验证后生成。</li>}</ol></section>
      <div className="callout info" style={{ marginTop: 26, marginBottom: 0 }}><CheckCircle2 size={18}/><div>本报告用于形成诊断假设和试点方案，不替代现场调查、数据验证及辅导员评审。</div></div>
    </article>
  </>;
}
