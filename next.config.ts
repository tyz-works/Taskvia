import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker multi-stage build (task_150) が .next/standalone を copy するために必要
  output: "standalone",
};

export default nextConfig;
