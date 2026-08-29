import type { NextConfig } from "next";

// Applied to every response. A Content-Security-Policy is deliberately NOT
// set here: the AI interview page pulls MediaPipe / TensorFlow.js WASM and
// model assets and opens a Socket.IO connection, so a CSP needs its own
// pass with that page exercised end-to-end before it can be locked down
// without breaking proctoring. Everything below is safe to apply blanket.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // camera/mic are needed by the same-origin interview page; nothing needs
    // geolocation or the topics API.
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  // Minimal self-contained server bundle for the Cloud Run container —
  // without this, the image ships the full node_modules tree instead of
  // just what's actually reachable at runtime.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
