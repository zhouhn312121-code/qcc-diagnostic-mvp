import { Topbar } from "@/components/Topbar";
import { HomeClient } from "@/components/HomeClient";

export default function Home() {
  return <div className="app-shell"><Topbar /><HomeClient /></div>;
}
