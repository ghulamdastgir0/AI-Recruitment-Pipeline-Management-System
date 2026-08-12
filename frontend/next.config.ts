import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Minimal self-contained server bundle for the Cloud Run container —
  // without this, the image ships the full node_modules tree instead of
  // just what's actually reachable at runtime.
  output: "standalone",
};

export default nextConfig;
