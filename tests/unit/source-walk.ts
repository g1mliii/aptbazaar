import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Shared helper for the CI grep guards (Phase 9.5/9.6/9.10). Walks a source tree and yields
// { path, source } for each matching file so a guard can assert nothing in the tree matches a
// banned pattern. Not a test itself; the vitest unit project only picks up *.test/*.spec files.

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage"]);

export interface SourceFile {
  /** Path relative to the repo root, with forward slashes (stable across OSes). */
  path: string;
  source: string;
}

// The guard suites (emoji/pii/secrets) each walk overlapping trees (app, lib). The source tree
// does not change within a test run, so memoize per (dir, extensions) to read each file once.
const cache = new Map<string, SourceFile[]>();

export function walkSource(
  dir: string,
  options: { extensions?: string[] } = {}
): SourceFile[] {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const cacheKey = `${dir}\\0${extensions.join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const root = process.cwd();
  const out: SourceFile[] = [];

  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!extensions.some((ext) => entry.name.endsWith(ext))) continue;
      out.push({
        path: relative(root, full).split("\\").join("/"),
        source: readFileSync(full, "utf8")
      });
    }
  };

  visit(join(root, dir));
  cache.set(cacheKey, out);
  return out;
}
