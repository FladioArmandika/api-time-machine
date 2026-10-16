import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { REPOS_DIR, type ApiConfig } from "./config.ts";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export function repoDir(api: ApiConfig): string {
  return join(REPOS_DIR, api.id);
}

/** Blobless clone (history only, file contents fetched on demand), or fetch if it already exists. */
export async function syncRepo(api: ApiConfig): Promise<void> {
  const dir = repoDir(api);
  if (!existsSync(join(dir, "HEAD"))) {
    mkdirSync(REPOS_DIR, { recursive: true });
    await run("git", [
      "clone", "--quiet", "--bare", "--filter=blob:none", "--single-branch",
      "--branch", api.branch, `https://github.com/${api.repo}.git`, dir,
    ], { maxBuffer: 64 * 1024 * 1024 });
  } else {
    await git(dir, "fetch", "--quiet", "--filter=blob:none", "origin", `+${api.branch}:${api.branch}`);
  }
}

export interface Snapshot {
  /** YYYY-MM, UTC */
  month: string;
  /** Commit at the tip of the branch at the end of that month (or now, for the current month). */
  commit: string;
  commitDate: string;
  /** Blob id of the spec file at that commit; null when the file didn't exist. */
  blob: string | null;
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString(); // first instant of the next month
}

/**
 * One snapshot per month: the state of the default branch at the end of the month
 * (first-parent, so it's what was actually on main). Months where the file didn't change
 * are dropped, so the result lists only months with a new version of the spec.
 */
export async function monthlySnapshots(api: ApiConfig, now = new Date()): Promise<Snapshot[]> {
  const dir = repoDir(api);
  const firstDate = (await git(dir, "log", "--reverse", "--format=%cI", api.branch, "--", api.path)).split("\n")[0];
  if (!firstDate) throw new Error(`${api.id}: ${api.path} has no history on ${api.branch}`);
  const months = monthsBetween(new Date(firstDate).toISOString().slice(0, 7), now.toISOString().slice(0, 7));

  const out: Snapshot[] = [];
  let prevBlob: string | null | undefined;
  for (const month of months) {
    const line = await git(dir, "rev-list", "-1", "--first-parent", `--before=${monthEnd(month)}`, "--format=%H %cI", "--no-commit-header", api.branch);
    if (!line) continue;
    const [commit, commitDate] = line.split(" ");
    let blob: string | null = null;
    try {
      blob = await git(dir, "rev-parse", "--verify", "--quiet", `${commit}:${api.path}`);
    } catch {
      blob = null;
    }
    if (blob === prevBlob) continue;
    prevBlob = blob;
    out.push({ month, commit, commitDate, blob });
  }
  return out;
}

/** Streams a blob to disk (specs can be tens of MB, too big to buffer comfortably via execFile). */
export function writeBlob(api: ApiConfig, blob: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = openSync(dest, "w");
    const child = spawn("git", ["cat-file", "blob", blob], { cwd: repoDir(api), stdio: ["ignore", fd, "pipe"] });
    let stderr = "";
    child.stderr!.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      closeSync(fd);
      code === 0 ? resolve() : reject(new Error(`git cat-file ${blob}: ${stderr}`));
    });
  });
}
