import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ARES ACCORD is entirely live state (an in-process negotiation engine). Cache Components would
  // prerender data-free GET handlers at build time and forbids `dynamic = 'force-dynamic'`, so it stays off.
  cacheComponents: false,
  reactCompiler: true,
  // Phase 3 ships a Docker image from the standalone output.
  output: "standalone",
  poweredByHeader: false,
  // Keep the Agents SDK out of the bundler: Node loads it at runtime.
  serverExternalPackages: [
    "@openai/agents",
    "@openai/agents-core",
    "@openai/agents-openai",
    "@openai/agents-realtime",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
