"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, GitBranch, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { calculateProcessChanges, processToDrawioXml, qccLaneMergeXml, qccNodeMergeXml, reanchorFacts, validateConvertedProcess, type DrawioConversion, type DrawioJson } from "@/lib/drawio";
import type { DrawioDraft, ProcessNodeType, ProcessStep, ProcessTransition, QccCase } from "@/lib/types";

const defaultDrawioUrl = "https://embed.diagrams.net/";

function statusLabel(status: DrawioDraft["syncStatus"]) {
  return status === "SYNCED" ? "已与QCC同步" : status === "STALE" ? "正式流程已更新，草稿已过期" : status === "CONFIRMING" ? "等待结构确认" : "有未应用草稿";
}

export function DrawioWorkbench({ item, stage, update }: { item: QccCase; stage: "AS_IS" | "TO_BE"; update: (item: QccCase) => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const draftKey = stage === "AS_IS" ? "asIsDrawio" : "toBeDrawio";
  const flowProcess = stage === "AS_IS" ? { steps: item.steps, transitions: item.transitions } : item.toBeProcess;
  const configuredUrl = process.env.NEXT_PUBLIC_DRAWIO_URL || defaultDrawioUrl;
  const allowedOrigin = useMemo(() => { try { return new URL(configuredUrl).origin; } catch { return new URL(defaultDrawioUrl).origin; } }, [configuredUrl]);
  const embedUrl = `${configuredUrl.replace(/\/?$/, "/")}?embed=1&proto=json&spin=1&configure=1&libraries=1&noSaveBtn=1&noExitBtn=1&suppressNewWindows=1`;
  const draft = item[draftKey];
  const canonicalXml = useMemo(() => processToDrawioXml(flowProcess?.steps || [], flowProcess?.transitions || []), [flowProcess?.steps, flowProcess?.transitions]);
  const [xml, setXml] = useState(draft?.xml || canonicalXml);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [preview, setPreview] = useState<DrawioConversion | null>(null);
  const [factMapping, setFactMapping] = useState<Record<string, string>>({});
  const [allowStale, setAllowStale] = useState(draft?.syncStatus !== "STALE");
  const mergeIndex = useRef(0);

  function post(message: object) { iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), allowedOrigin); }
  function setDraft(nextXml: string, syncStatus: DrawioDraft["syncStatus"]) {
    setXml(nextXml);
    update({ ...item, [draftKey]: { stage, xml: nextXml, updatedAt: new Date().toISOString(), basedOnVersion: item.version, syncStatus } });
  }
  function loadCanonical() {
    setPreview(null); setAllowStale(true); setDraft(canonicalXml, "SYNCED"); post({ action: "load", xml: canonicalXml, autosave: 1, title: stage === "AS_IS" ? "QCC AS IS流程" : "QCC TO BE流程", noSaveBtn: 1, noExitBtn: 1 });
  }
  function saveDraft() { post({ action: "export", format: "xml" }); }
  function requestApply() { post({ action: "export", format: "json", includeData: true, compressed: false }); }
  function safeMerge(nextXml: string) { post({ action: "resetEditor" }); window.setTimeout(() => post({ action: "merge", xml: nextXml }), 40); }
  function addNode(nodeType: ProcessNodeType) { safeMerge(qccNodeMergeXml(nodeType, mergeIndex.current++)); }
  function addLane() { safeMerge(qccLaneMergeXml(mergeIndex.current++)); }

  useEffect(() => {
    if (!item[draftKey]) update({ ...item, [draftKey]: { stage, xml, updatedAt: new Date().toISOString(), basedOnVersion: item.version, syncStatus: "SYNCED" } });
  }, [draftKey, item, stage, update, xml]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { if (!ready) setUnavailable(true); }, 12000);
    const receive = async (event: MessageEvent) => {
      if (event.origin !== allowedOrigin || event.source !== iframeRef.current?.contentWindow) return;
      let message: Record<string, unknown>;
      try { message = typeof event.data === "string" ? JSON.parse(event.data) : event.data as Record<string, unknown>; } catch { return; }
      if (message.event === "configure") {
        post({ action: "configure", config: { defaultLibraries: "general;flowchart", enabledLibraries: ["general", "flowchart"], enableCustomLibraries: false, defaultColors: ["#23285B", "#087EB7", "#EAF3F8", "#FFF2CC", "#FFFFFF"] } });
      } else if (message.event === "init") {
        setReady(true); setUnavailable(false); post({ action: "load", xml, autosave: 1, title: stage === "AS_IS" ? "QCC AS IS流程" : "QCC TO BE流程", noSaveBtn: 1, noExitBtn: 1 });
      } else if (message.event === "autosave" && typeof message.xml === "string") {
        setDraft(message.xml, "DIRTY");
      } else if (message.event === "export" && message.format === "xml") {
        const nextXml = typeof message.xml === "string" ? message.xml : typeof message.data === "string" && message.data.startsWith("<") ? message.data : xml;
        setDraft(nextXml, "DIRTY");
      } else if (message.event === "export" && message.format === "json") {
        let diagram: DrawioJson | null = null; let nextXml = xml;
        try {
          const exported = typeof message.data === "string" ? JSON.parse(message.data) : message.data as DrawioJson & { data?: string };
          diagram = exported; if (typeof exported?.data === "string") nextXml = exported.data;
        } catch { diagram = null; }
        if (!diagram) { setUnavailable(true); return; }
        const response = await fetch("/api/process/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: item.id, stage, diagram }) });
        const data = await response.json();
        if (!response.ok) { setUnavailable(true); return; }
        setXml(nextXml); setPreview(data.conversion); setDraft(nextXml, "CONFIRMING");
      }
    };
    window.addEventListener("message", receive);
    return () => { window.clearTimeout(timeout); window.removeEventListener("message", receive); };
  }, [allowedOrigin, item, ready, stage, xml]);

  if (!flowProcess) return <div className="empty-tobe"><GitBranch/><strong>请先复制AS IS或生成TO BE草案</strong></div>;
  if (draft?.syncStatus === "STALE" && !allowStale) return <div className="drawio-stale"><AlertTriangle/><h4>draw.io草稿已过期</h4><p>正式流程已更新。你可以基于最新流程重新生成，也可以继续旧草稿后再查看影响。</p><div><button className="btn primary" onClick={loadCanonical}>基于最新流程重新生成</button><button className="btn ghost" onClick={() => setAllowStale(true)}>继续旧草稿</button></div></div>;
  if (preview) return <ConversionConfirm item={item} stage={stage} preview={preview} xml={xml} factMapping={factMapping} setFactMapping={setFactMapping} cancel={() => { setPreview(null); setDraft(xml, "DIRTY"); }} apply={(conversion) => {
    const syncedDraft: DrawioDraft = { stage, xml, updatedAt: new Date().toISOString(), basedOnVersion: item.version, syncStatus: "SYNCED" };
    if (stage === "AS_IS") {
      const facts = reanchorFacts(item.processFacts, factMapping, conversion.steps, conversion.transitions);
      update({ ...item, steps: conversion.steps, transitions: conversion.transitions, processFacts: facts, asIsDrawio: syncedDraft, toBeDrawio: item.toBeDrawio ? { ...item.toBeDrawio, syncStatus: "STALE" } : null, diagnosisStale: item.findings.length > 0 });
    } else if (item.toBeProcess) {
      const causeIds = item.hypotheses.filter((cause) => cause.status === "证据支持").map((cause) => cause.id);
      const measureIds = item.countermeasures.filter((measure) => causeIds.includes(measure.causeId)).map((measure) => measure.id);
      update({ ...item, toBeProcess: { ...item.toBeProcess, steps: conversion.steps, transitions: conversion.transitions, changes: calculateProcessChanges(item.steps, conversion.steps, causeIds, measureIds), reviewed: false, userEdited: true }, toBeDrawio: syncedDraft });
    }
    setPreview(null);
  }}/>;

  return <div className="drawio-workbench">
    <div className="drawio-head"><div><strong>draw.io自由绘制</strong><span className={`drawio-status ${draft?.syncStatus || "SYNCED"}`}>{statusLabel(draft?.syncStatus || "SYNCED")}</span></div><p>“部门泳道”会同时创建一个泳道内活动；后续活动可直接拖入泳道，转换时自动继承泳道责任部门。</p></div>
    <div className="drawio-toolbar"><span>QCC专用节点</span><button onClick={() => addNode("START")}><Plus size={13}/>开始</button><button onClick={() => addNode("ACTION")}><Plus size={13}/>活动</button><button onClick={() => addNode("DECISION")}><Plus size={13}/>判断</button><button onClick={() => addNode("END")}><Plus size={13}/>结束</button><button onClick={addLane}><Plus size={13}/>部门泳道</button><i/><button onClick={() => post({ action: "fit", border: 20, maxScale: 1 })}>适应画布</button><button onClick={saveDraft}><Save size={13}/>保存草稿</button><button onClick={loadCanonical}><Trash2 size={13}/>放弃修改</button><button className="primary-action" onClick={requestApply}><CheckCircle2 size={13}/>应用到QCC</button></div>
    {unavailable && <div className="callout error"><AlertTriangle size={18}/><div><strong>draw.io暂时无法访问</strong><br/>你的QCC正式流程没有被修改，可以切回智能流程搭建继续工作。<button className="inline-retry" onClick={() => { setUnavailable(false); if (iframeRef.current) iframeRef.current.src = embedUrl; }}><RefreshCw size={12}/>重试</button></div></div>}
    <iframe ref={iframeRef} className="drawio-frame" src={embedUrl} title={stage === "AS_IS" ? "draw.io AS IS流程编辑器" : "draw.io TO BE流程编辑器"} onError={() => setUnavailable(true)}/>
  </div>;
}

function ConversionConfirm({ item, stage, preview, xml, factMapping, setFactMapping, cancel, apply }: { item: QccCase; stage: "AS_IS" | "TO_BE"; preview: DrawioConversion; xml: string; factMapping: Record<string, string>; setFactMapping: (value: Record<string, string>) => void; cancel: () => void; apply: (conversion: DrawioConversion) => void }) {
  const [steps, setSteps] = useState(preview.steps);
  const [transitions, setTransitions] = useState(preview.transitions);
  const errors = validateConvertedProcess(steps, transitions);
  const unresolvedFacts = preview.impact.orphanFactIds.filter((id) => !factMapping[id]);
  const hasSupportedCause = item.hypotheses.some((cause) => cause.status === "证据支持");
  const blocked = errors.length > 0 || unresolvedFacts.length > 0 || stage === "TO_BE" && !hasSupportedCause;
  function patchStep(id: string, patch: Partial<ProcessStep>) { setSteps(steps.map((step) => step.id === id ? { ...step, ...patch, decisionTitle: step.nodeType === "DECISION" && patch.name ? patch.name : step.decisionTitle } : step)); }
  function patchTransition(id: string, patch: Partial<ProcessTransition>) { setTransitions(transitions.map((transition) => transition.id === id ? { ...transition, ...patch } : transition)); }
  return <div className="conversion-confirm">
    <div className="panel-title"><div><h3>确认QCC流程结构</h3><p>已识别{steps.length}个节点、{transitions.length}条连线；{preview.ignored.length}个装饰图形不会进入诊断。</p></div><span className="badge amber">正式流程尚未覆盖</span></div>
    {(preview.impact.deletedNodeIds.length > 0 || preview.impact.findings > 0 || preview.impact.hasToBe) && <div className="callout warn"><AlertTriangle size={18}/><div><strong>应用前影响预览</strong><br/>将删除{preview.impact.deletedNodeIds.length}个节点、{preview.impact.deletedTransitionIds.length}条连线。{preview.impact.findings ? `已有${preview.impact.findings}条断点将标记为需要重新诊断。` : ""}{preview.impact.hasToBe ? "已有TO BE需要重新核对。" : ""}</div></div>}
    {preview.ignored.length > 0 && <details className="ignored-shapes"><summary>查看{preview.ignored.length}个已忽略图形</summary>{preview.ignored.map((shape) => <span key={shape.id}>{shape.label}</span>)}</details>}
    <div className="confirm-table-wrap"><table className="confirm-table"><thead><tr><th>类型</th><th>步骤名称</th><th>责任岗位</th><th>输入</th><th>实际活动</th><th>输出</th><th>标准/时限</th></tr></thead><tbody>{steps.map((step) => <tr key={step.id}><td>{step.nodeType === "START" ? "开始" : step.nodeType === "END" ? "结束" : step.nodeType === "DECISION" ? "判断" : "活动"}</td><td><input value={step.name} onChange={(event) => patchStep(step.id, { name: event.target.value })}/></td>{(["owner", "input", "activity", "output", "standard"] as const).map((key) => <td key={key}><input disabled={step.nodeType === "START" || step.nodeType === "END"} value={step[key]} onChange={(event) => patchStep(step.id, { [key]: event.target.value })}/></td>)}</tr>)}</tbody></table></div>
    {steps.some((step) => step.nodeType === "DECISION") && <div className="branch-confirm"><h4>判断分支确认</h4>{transitions.filter((transition) => steps.find((step) => step.id === transition.sourceNodeId)?.nodeType === "DECISION").map((transition) => <div key={transition.id}><strong>{steps.find((step) => step.id === transition.sourceNodeId)?.name}</strong><input placeholder="分支名称" value={transition.branchName} onChange={(event) => patchTransition(transition.id, { branchName: event.target.value })}/><input placeholder="判断条件" value={transition.conditionExpression} onChange={(event) => patchTransition(transition.id, { conditionExpression: event.target.value })}/><span>→ {steps.find((step) => step.id === transition.targetNodeId)?.name}</span></div>)}</div>}
    {preview.impact.orphanFactIds.length > 0 && <div className="fact-reanchor"><h4>处理失效的异常事实</h4><p>每条事实必须重新关联到新节点，或明确删除。</p>{preview.impact.orphanFactIds.map((factId) => { const fact = item.processFacts.find((candidate) => candidate.id === factId); return <label key={factId}><span>{fact?.anchorLabel}：{fact?.description}</span><select value={factMapping[factId] || ""} onChange={(event) => setFactMapping({ ...factMapping, [factId]: event.target.value })}><option value="">请选择处理方式</option>{steps.map((step) => <option key={step.id} value={step.id}>重新关联：{step.name}</option>)}<option value="DELETE">删除这条事实</option></select></label>; })}</div>}
    {stage === "TO_BE" && !hasSupportedCause && <div className="callout error"><AlertTriangle size={18}/><div>TO BE变更必须关联至少一个“证据支持”的原因。</div></div>}
    {errors.length > 0 && <div className="flow-warnings">{errors.map((error, index) => <span key={`${index}-${error}`}>⚠ {error}</span>)}</div>}
    <div className="conversion-actions"><button className="btn ghost" onClick={cancel}>返回draw.io继续修改</button><button className="btn primary" disabled={blocked} onClick={() => apply({ ...preview, steps, transitions, errors })}>确认并更新QCC正式流程</button></div>
    <input type="hidden" value={xml.length}/>
  </div>;
}
