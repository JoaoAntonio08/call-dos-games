import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // gera .next/standalone (servidor Node próprio) para rodar fora da Vercel; na Vercel não muda nada
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
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
