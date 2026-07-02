import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { CaseWorkspace } from "@/components/CaseWorkspace";
import { getCase } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getCase(id);
  if (!item) notFound();
  return <div className="app-shell"><Topbar/><CaseWorkspace initialCase={item}/></div>;
}
