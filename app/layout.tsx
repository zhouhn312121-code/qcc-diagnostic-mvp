import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QCC流程破题诊断器",
  description: "从流程断点到根因验证与改善方案的QCC诊断工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
