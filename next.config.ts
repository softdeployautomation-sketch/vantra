import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vantra runs as a real Node server (holds the TRMM API key server-side).
  // Do NOT set output:"export" — that would break server-only code and route handlers.
  //
  // `output: "standalone"` is ONLY enabled for the desktop EXE build path: CI's
  // build-exe.yml sets BUILD_TARGET before `next build`, and
  // scripts/runtime-assemble.mjs packs the resulting `.next/standalone/` tree as
  // the EXE's bundled local runtime (Task 44.3). The hosted web deploy never sets
  // BUILD_TARGET, so it gets plain output — matching what its systemd unit runs
  // (`next start`). Conditioning it here (SpaceWorker's proven pattern) is what
  // lets the same repo serve both the hosted app and the packaged EXE.
  output: process.env.BUILD_TARGET ? "standalone" : undefined,
  // Only native-binding packages need to be externalized (bcrypt, Prisma); do NOT
  // add "server-only"/"jose"/"resend" here — those are pure JS and if externalized
  // the real npm "server-only" resolves to its throwing index.js and breaks builds.
  serverExternalPackages: ["bcrypt", "@prisma/client"],
  // Pin the workspace root explicitly — an unrelated package.json in the parent
  // home directory otherwise confuses Turbopack's root inference, causing bogus
  // "/ROOT/..." module resolution errors that abort the production build (hit on
  // the SpaceWorker EXE build for the same reason).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;