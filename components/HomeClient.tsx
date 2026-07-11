"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CirclePlus, GitBranch, SearchCheck, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import type { CaseSummary } from "@/lib/types";

function typeClass(type: string) {
  return type === "质量" ? "red" : type === "交付" ? "blue" : type === "库存" ? "amber" : "green";
}

export function HomeClient() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CaseSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [toast, setToast] = useState("");
  const router = useRouter();

  useEffect(() => { fetch("/api/cases").then((r) => r.json()).then((data) => setCases(data.cases)).finally(() => setLoading(false)); }, []);
  async function createCase() {
    setCreating(true);
    const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await response.json();
    router.push(`/cases/${data.case.id}`);
  }
  useEffect(() => {
    if (!deleting) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !deleteBusy) setDeleting(null); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [deleting, deleteBusy]);
  async function deleteCase() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError("");
    try {
      const response = await fetch(`/api/cases/${deleting.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "删除失败，请稍后重试");
      setCases((current) => current.filter((item) => item.id !== deleting.id)); setDeleting(null); setToast("课题已删除");
      window.setTimeout(() => setToast(""), 2800);
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试"); }
    finally { setDeleteBusy(false); }
  }

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-main">
          <span className="eyebrow">QCC Process Diagnostic</span>
          <h1>先定位流程断点，<br />再验证根因、设计方案</h1>
          <p>面向制造与供应链改善骨干的引导式诊断工具。AI只提出可追溯的假设，不替代现场验证；只有证据支持的原因，才会进入方案设计。</p>
          <button className="btn primary" onClick={createCase} disabled={creating}>
            {creating ? <span className="spinner" /> : <CirclePlus size={18} />} 新建改善课题
          </button>
        </div>
        <aside className="hero-card">
          <h3>一条严谨的破题链</h3>
          <div className="chain">
            <div className="chain-item"><span className="chain-num"><GitBranch size={14}/></span>界定问题与流程边界</div>
            <div className="chain-item"><span className="chain-num"><SearchCheck size={14}/></span>扫描六类流程断点</div>
            <div className="chain-item"><span className="chain-num"><ShieldCheck size={14}/></span>为原因假设设计验证</div>
            <div className="chain-item"><span className="chain-num"><Sparkles size={14}/></span>为已验证原因生成方案</div>
          </div>
        </aside>
      </section>

      <section>
        <div className="section-head">
          <div><h2>改善课题</h2><p>内置五类制造/供应链案例，可直接进入体验。</p></div>
          <span className="badge gray">{cases.length} 个课题</span>
        </div>
        {loading ? <div className="loading">正在准备课题…</div> : (
          <div className="case-grid">
            {cases.map((item) => (
              <article key={item.id} className="case-card">
                <div className="case-card-top"><h3>{item.title}</h3><div className="case-card-actions"><span className={`badge ${typeClass(item.problemType)}`}>{item.problemType}</span><button title="删除课题" aria-label={`删除课题：${item.title}`} className="delete-case" onClick={() => { setDeleteError(""); setDeleting(item); }}><Trash2 size={15}/></button></div></div>
                <span className="badge gray">{item.status}</span>
                <div className="metrics"><span><b>{item.findings}</b>断点</span><span><b>{item.supportedCauses}</b>已验证原因</span></div>
                <div className="case-card-bottom"><span>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span><button className="enter-case" onClick={() => router.push(`/cases/${item.id}`)}>进入诊断 <ArrowRight size={14}/></button></div>
              </article>
            ))}
          </div>
        )}
      </section>
      {deleting && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteBusy) setDeleting(null); }}><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="danger-icon"><Trash2 size={22}/></div><h3 id="delete-title">确认删除课题？</h3><p className="delete-name">{deleting.title}</p><p>删除后，该课题的流程、诊断结果、原因验证和改善方案将无法恢复。</p>{deleteError && <div className="modal-error">{deleteError}</div>}<div className="modal-actions"><button autoFocus className="btn ghost" disabled={deleteBusy} onClick={() => setDeleting(null)}>取消</button><button className="btn danger" disabled={deleteBusy} onClick={deleteCase}>{deleteBusy ? <span className="spinner"/> : <Trash2 size={15}/>}确认删除</button></div></div></div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
