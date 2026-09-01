import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vantra runs as a real Node server (holds the TRMM API key server-side).
  // Do NOT set output:"export" — that would break server-only code and route handlers.
  // Only native-binding packages need to be externalized (bcrypt, Prisma); do NOT
  // add "server-only"/"jose"/"resend" here — those are pure JS and if externalized
  // the real npm "server-only" resolves to its throwing index.js and breaks builds.
  serverExternalPackages: ["bcrypt", "@prisma/client"],
};

export default nextConfig;