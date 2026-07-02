"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpenCheck, CheckCircle2, Clipboard, Download, FileSearch, GitBranch, Lightbulb, Plus, Printer, Save, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { caseProgress, emptyStep, readinessIssues } from "@/lib/case-utils";
import { problemTypes, type CauseHypothesis, type Countermeasure, type ProcessFinding, type QccCase } from "@/lib/types";

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
  const [running, setRunning] = useState<"diagnose" | "solutions" | null>(null);
  const [toast, setToast] = useState("");
  const router = useRouter();
  const issues = useMemo(() => readinessIssues(item), [item]);
  const progress = useMemo(() => caseProgress(item), [item]);

  function notify(message: string) {
    setToast(message); window.setTimeout(() => setToast(""), 2800);
  }
  function update(next: QccCase) { setItem(next); setDirty(true); }
  function updateField<K extends keyof QccCase>(key: K, value: QccCase[K]) { update({ ...item, [key]: value }); }

  async function save(silent = false) {
    setSaving(true);
    try {
      const response = await fetch(`/api/cases/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setItem(data.case); setDirty(false); if (!silent) notify("课题已保存");
      return data.case as QccCase;
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败"); return null; }
    finally { setSaving(false); }
  }

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

  function updateStep(index: number, key: keyof QccCase["steps"][number], value: string) {
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
            <button className="btn ghost" onClick={() => save()} disabled={saving || !dirty}>{saving ? <span className="spinner"/> : <Save size={16}/>}<span className="label">{dirty ? "保存" : "已保存"}</span></button>
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
    </div>
  );
}

function ProblemStage({ item, updateField, update, updateStep, runDiagnosis, issues, running }: { item: QccCase; updateField: <K extends keyof QccCase>(key: K, value: QccCase[K]) => void; update: (item: QccCase) => void; updateStep: (index: number, key: keyof QccCase["steps"][number], value: string) => void; runDiagnosis: () => void; issues: string[]; running: string | null }) {
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
      <div className="panel-title"><div><h3>AS IS关键流程步骤</h3><p>填写实际怎么做，而不是制度文件规定应该怎么做。首版支持5–7个步骤。</p></div><button className="btn ghost" disabled={item.steps.length >= 7} onClick={() => update({ ...item, steps: [...item.steps, emptyStep(item.steps.length + 1)] })}><Plus size={15}/>增加步骤</button></div>
      <div style={{ overflowX: "auto" }}><table className="step-table"><thead><tr><th className="narrow">#</th><th>步骤</th><th>主责</th><th>输入</th><th>实际活动</th><th>输出</th><th>标准/时限</th><th>异常事实</th><th></th></tr></thead><tbody>
        {item.steps.map((step, index) => <tr key={step.id}><td className="narrow">{index + 1}</td>{(["name","owner","input","activity","output","standard","anomaly"] as const).map((key) => <td key={key}><input value={step[key]} onChange={(e) => updateStep(index, key, e.target.value)} placeholder={key === "activity" ? "实际怎么做" : ""}/></td>)}<td><button className="icon-btn" disabled={item.steps.length <= 5} onClick={() => update({ ...item, steps: item.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })) })}><Trash2 size={14}/></button></td></tr>)}
      </tbody></table></div>
    </section>
    <div className={`callout ${issues.length ? "warn" : "success"}`}><ShieldAlert size={19}/><div><strong>{issues.length ? `诊断前还需补充${issues.length}项` : "信息完整，可以开始诊断"}</strong>{issues.length > 0 && <ul className="issues">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}</div></div>
    <label className="callout info" style={{ cursor: "pointer" }}><input type="checkbox" checked={item.sanitizedConfirmed} onChange={(e) => updateField("sanitizedConfirmed", e.target.checked)} /><div><strong>我确认资料已经脱敏</strong><br/>不包含客户名称、人员姓名、合同编号或其他敏感数据。</div></label>
    <button className="btn blue" disabled={issues.length > 0 || running === "diagnose"} onClick={runDiagnosis}>{running === "diagnose" ? <span className="spinner"/> : <Sparkles size={17}/>}开始流程断点诊断</button>
  </>;
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
