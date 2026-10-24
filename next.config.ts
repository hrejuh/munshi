import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Owner photos are posted as base64 data URLs from the browser.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
