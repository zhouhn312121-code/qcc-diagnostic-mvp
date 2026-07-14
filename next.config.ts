import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@napi-rs/canvas"],
  // Keep the long-running local dev cache separate from production builds.
  // Running `pnpm build` must never invalidate an active `pnpm dev` session.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
