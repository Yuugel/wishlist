import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the project-local AGENTS.md owned by the Wishlist workflow.
  agentRules: false,
};

export default nextConfig;
