import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = join(ROOT, "data");
export const CACHE_DIR = join(ROOT, ".cache");
export const REPOS_DIR = join(CACHE_DIR, "repos");
export const TMP_DIR = join(CACHE_DIR, "tmp");
export const SEVERITY_LEVELS = join(ROOT, "pipeline/config/severity-levels.txt");
export const OASDIFF = process.env.OASDIFF ?? "oasdiff";
/** The version CI installs. `go install` builds report "main" as their version, so this is recorded instead. */
export const OASDIFF_VERSION = "1.33.0";

/** How many oasdiff processes run at once. Each can use a couple of GB on the largest specs. */
export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);

export interface ApiConfig {
  id: string;
  name: string;
  repo: string;
  branch: string;
  path: string;
  notes?: string;
}

export function loadApis(): ApiConfig[] {
  const all: ApiConfig[] = JSON.parse(readFileSync(join(ROOT, "apis.json"), "utf8"));
  const only = process.env.ONLY?.split(",");
  return only ? all.filter((a) => only.includes(a.id)) : all;
}
