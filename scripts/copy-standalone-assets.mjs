import { cpSync, existsSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function copyStandaloneAssets({ projectRoot = process.cwd(), distDir = process.env.NEXT_DIST_DIR || ".next" } = {}) {
  if (process.env.NEXT_TRACING_ROOT_MODE === "workspace") {
    console.log("[standalone-assets] Skipping workspace-traced CLI build; CLI packaging handles assets");
    return;
  }

  const buildDir = resolve(projectRoot, distDir);
  const standaloneDir = resolve(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    console.log(`[standalone-assets] No standalone build found at ${standaloneDir}`);
    return;
  }

  const staticSource = resolve(buildDir, "static");
  const staticDestination = resolve(standaloneDir, distDir, "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, staticDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied static assets to ${staticDestination}`);
  }

  const publicSource = resolve(projectRoot, "public");
  const publicDestination = resolve(standaloneDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied public assets to ${publicDestination}`);
  }

  // Without it beside server.js the standalone build serves requests unsanitized.
  const serverWrapperSource = resolve(projectRoot, "custom-server.js");
  const serverWrapperDestination = resolve(standaloneDir, "custom-server.js");
  if (existsSync(serverWrapperSource)) {
    cpSync(serverWrapperSource, serverWrapperDestination, { force: true });
    console.log(`[standalone-assets] Copied custom-server.js to ${serverWrapperDestination}`);
  }

  // custom-server.js imports server modules by absolute path under its own
  // __dirname (dashboardGuard + auth-guard-hooks, securityLogRepo,
  // dashboardSession, telegramBackup, backgroundTokenRefresh). `next build`
  // only traces the subset of src/ that reached the webpack graph, so those
  // files are absent from standalone/ and getGuardModule() finds nothing,
  // answering 503 "guard unavailable" instead of serving. assemble.sh stages
  // the same tree for the systemd unit; this makes the plain
  // `npm run build && npm start` (and `bun run build:bun && bun run start:bun`)
  // path work without running assemble.sh first.
  for (const dir of ["src", "scripts", "open-sse"]) {
    const dirSource = resolve(projectRoot, dir);
    const dirDestination = resolve(standaloneDir, dir);
    if (!existsSync(dirSource)) continue;
    rmSync(dirDestination, { recursive: true, force: true });
    cpSync(dirSource, dirDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied ${dir}/ to ${dirDestination}`);
  }

  // The auth guard is one of those absolutely-loaded modules, and it imports
  // `next/server`. Output-file tracing never sees that import - it is not in the
  // webpack graph, it is a runtime import from a file copied after the build - so
  // the standalone tree kept only a partial `next` package and the server
  // answered 503 "guard unavailable" with ENOENT node_modules/next/server.js.
  // assemble.sh has always mirrored the full package for the systemd unit; the
  // npm/bun build path needs the same tree to be servable.
    const standaloneServer = resolve(standaloneDir, "server.js");
  const rootServer = resolve(projectRoot, "server.js");
  if (existsSync(standaloneServer)) {
    cpSync(standaloneServer, rootServer, { force: true });
    console.log(`[standalone-assets] Synchronized ${rootServer}`);
  }

  const pkgJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  const depsToMirror = [...Object.keys(pkgJson.dependencies || {}), "@aws-sdk"].filter(p => p !== "better-sqlite3");
  for (const pkg of depsToMirror) {
    const pkgSource = resolve(projectRoot, "node_modules", pkg);
    const pkgDestination = resolve(standaloneDir, "node_modules", pkg);
    if (existsSync(pkgSource)) {
      try {
        rmSync(pkgDestination, { recursive: true, force: true });
        cpSync(pkgSource, pkgDestination, { recursive: true, force: true, dereference: true });
        console.log(`[standalone-assets] Mirrored ${pkg} to standalone node_modules`);
      } catch (err) {
        console.warn(`[standalone-assets] Could not mirror ${pkg}: ${err.message}`);
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), "copy-standalone-assets.mjs")) {
  copyStandaloneAssets();
}
