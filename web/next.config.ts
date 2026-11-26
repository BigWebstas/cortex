import type { NextConfig } from "next"

import { sourceBuildId } from "./scripts/build-id.mjs"

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/app",
  trailingSlash: true,
  // Next picks a random ID by default, which makes every export differ.
  generateBuildId: () => sourceBuildId(process.cwd()),
}

export default nextConfig
