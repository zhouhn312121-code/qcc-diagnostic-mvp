import Link from "next/link";

export function Topbar() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark">QCC</span>
        <span>流程破题诊断器 <span className="brand-sub">从流程断点到验证后方案</span></span>
      </Link>
      <span className="badge blue">MVP · 单机版</span>
    </header>
  );
}
