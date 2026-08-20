import path from "path";
import type { NextConfig } from "next";

const root = path.resolve(__dirname);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: root,
  turbopack: {
    root,
  },
};

export default nextConfig;
