import type { NextConfig } from "next";

const repositoryBasePath = "/proto";

const nextConfig: NextConfig = {
  output: "export",
  basePath: repositoryBasePath,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
