import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Next's build ID to the deploying commit on Vercel (ADR-0002 CS-1).
  // serwist.config.mjs reads .next/BUILD_ID and bakes it into every runtime
  // cache name (strix-shell-<id>, strix-dashboard-<id>), so making the build
  // ID the commit SHA gives deterministic cache eviction on deploy and a
  // self-healing rollback. Returning null off-Vercel (local builds) falls back
  // to Next's own generated BUILD_ID — the documented default behaviour.
  generateBuildId: async () => process.env.VERCEL_GIT_COMMIT_SHA ?? null,
};

export default nextConfig;
