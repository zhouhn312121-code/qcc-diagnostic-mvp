import Link from "next/link";
import { Topbar } from "@/components/Topbar";

export default function NotFound() {
  return <div className="app-shell"><Topbar/><main className="home"><div className="panel empty"><h2>没有找到这个课题</h2><p>它可能已经被删除，或链接不完整。</p><Link className="btn primary" href="/">返回课题列表</Link></div></main></div>;
}
