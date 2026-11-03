// Fail-closed risk classification for GitHub Actions. Only changes to
// application stylesheet files may use the fast UI lane. TypeScript/JavaScript,
// tests, dependencies, migrations, infrastructure, workflows, or this classifier
// always receive the full validation and production gates.
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const PUBLIC_CSS = /^apps\/public\/src\/.+\.css$/;
const ADMIN_CSS = /^apps\/admin\/src\/.+\.css$/;

export function classifyCiChanges(paths) {
  const files = [...new Set(paths.filter(value => typeof value === "string" && value.length > 0))];
  const isUi = files.length > 0 && files.every(path => PUBLIC_CSS.test(path) || ADMIN_CSS.test(path));
  const geoCss = files.some(path => path.startsWith("apps/public/src/geo/") && PUBLIC_CSS.test(path));
  const publicOtherCss = files.some(path => PUBLIC_CSS.test(path) && !path.startsWith("apps/public/src/geo/"));
  const adminCss = files.some(path => ADMIN_CSS.test(path));
  // All non-CSS changes remain full-risk, including test or workflow edits.
  const lane = isUi ? "ui" : "full";
  const smoke = isUi
    ? [
        ...(geoCss ? ["e2e/geo-mobile-viewport-fit.spec.ts", "e2e/geo-true-north-compass.spec.ts"] : []),
        ...(publicOtherCss ? ["e2e/public-building.spec.ts"] : []),
        ...(adminCss ? ["e2e/client-admin-responsive-motion.spec.ts"] : []),
      ]
    : [];
  return {
    lane,
    changed_count: files.length,
    ui_admin_changed: lane === "ui" && adminCss,
    ui_public_changed: lane === "ui" && (geoCss || publicOtherCss),
    // The separate, expensive live Building browser suite is relevant only to
    // non-Geo Public CSS, or to full-risk changes. Production readiness and
    // release-integrity checks are NEVER skipped by this value.
    run_building_browser: lane === "full" || publicOtherCss,
    fast_browser_specs: smoke.join(" "),
  };
}

function changedFilesFor(mode) {
  if (mode !== "pr" && mode !== "push") throw new Error("Expected pr or push");
  // Pull-request checkouts normally use a synthetic merge commit: merge-base
  // against origin/main gets the proposed changes, not the whole repository.
  // Pushes compare the MERGE COMMIT to its first parent (prior production).
  const range = mode === "pr" ? "origin/main...HEAD" : "HEAD^1..HEAD";
  const raw = execFileSync("git", ["diff","--name-only","--no-renames",range], {
    encoding:"utf8", maxBuffer:5*1024*1024,
  });
  return raw.split("\n").filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    const changed = changedFilesFor(mode);
    const result = classifyCiChanges(changed);
    // Use stdout for $GITHUB_OUTPUT. Output values are all derived from
    // constant known-safe strings; changed filenames are never interpolated.
    for (const [key,value] of Object.entries(result)) {
      process.stdout.write(key + "=" + value + "\n");
    }
    process.stderr.write("CI " + result.lane + ": " + changed.length + " changed file(s)\n");
  } catch (error) {
    // No partial / successful fallback to a fast lane when git fails.
    process.stderr.write("CI scope resolution failed: " + String(error) + "\n");
    process.exitCode = 1;
  }
}
