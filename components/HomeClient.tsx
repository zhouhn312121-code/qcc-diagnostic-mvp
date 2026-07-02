"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CirclePlus, GitBranch, SearchCheck, ShieldCheck, Sparkles } from "lucide-react";
import type { CaseSummary } from "@/lib/types";

function typeClass(type: string) {
  return type === "质量" ? "red" : type === "交付" ? "blue" : type === "库存" ? "amber" : "green";
}

export function HomeClient() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => { fetch("/api/cases").then((r) => r.json()).then((data) => setCases(data.cases)).finally(() => setLoading(false)); }, []);
  async function createCase() {
    setCreating(true);
    const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await response.json();
    router.push(`/cases/${data.case.id}`);
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
              <button key={item.id} className="case-card" onClick={() => router.push(`/cases/${item.id}`)} style={{ textAlign: "left" }}>
                <div className="case-card-top"><h3>{item.title}</h3><span className={`badge ${typeClass(item.problemType)}`}>{item.problemType}</span></div>
                <span className="badge gray">{item.status}</span>
                <div className="metrics"><span><b>{item.findings}</b>断点</span><span><b>{item.supportedCauses}</b>已验证原因</span></div>
                <div className="case-card-bottom"><span>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span><span>进入诊断 <ArrowRight size={14}/></span></div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
