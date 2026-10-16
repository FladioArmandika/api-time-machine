import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { CACHE_DIR, CONCURRENCY, DATA_DIR, OASDIFF, TMP_DIR, loadApis, type ApiConfig } from "./config.ts";
import { diffSpecs, inspectSpec, type DiffSummary, type SpecInfo } from "./diff.ts";
import { monthlySnapshots, syncRepo, writeBlob, type Snapshot } from "./git.ts";
import { buildHeadlines } from "./headlines.ts";
import { HALF_LIFE_MONTHS, K, SOFT_WEIGHT, WINDOW_MONTHS, monthsAgo, stabilityScore, weatherLabel } from "./score.ts";

const run = promisify(execFile);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- small helpers ----------

function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

function writeJson(file: string, value: unknown, pretty = true): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, pretty ? 2 : undefined) + "\n");
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const short = (sha: string) => sha.slice(0, 12);

// ---------- per-API data ----------

interface SnapshotOut extends Snapshot {
  openapi?: string;
  operations?: number;
  valid: boolean;
  invalidReason?: string;
}

export interface Interval {
  from: string; // month of the base snapshot
  to: string; // month of the revision snapshot; activity is attributed to this month
  fromCommit: string;
  toCommit: string;
  /** true when the spec was missing or unreadable between these snapshots, so no diff was taken. */
  gap: boolean;
  /** the "to" snapshot is the current, still-open month */
  partial: boolean;
  operations: number;
  hard: number;
  soft: number;
  info: number;
  hardOperations: number;
  changes: DiffSummary["changes"];
  repairedRefs?: number;
  error?: string;
}

interface Prepared {
  api: ApiConfig;
  snapshots: SnapshotOut[];
  pairs: { from: SnapshotOut; to: SnapshotOut; gap: boolean }[];
  specCache: Record<string, SpecInfo>;
  cacheDir: string;
}

async function prepare(api: ApiConfig, now: Date): Promise<Prepared> {
  await syncRepo(api);
  const raw = await monthlySnapshots(api, now);
  const cacheDir = join(DATA_DIR, "cache", api.id);
  const specCachePath = join(cacheDir, "specs.json");
  const specCache = readJson<Record<string, SpecInfo>>(specCachePath, {});
  const tmp = join(TMP_DIR, api.id);
  mkdirSync(tmp, { recursive: true });

  const snapshots: SnapshotOut[] = [];
  for (const s of raw) {
    if (!s.blob) { snapshots.push({ ...s, valid: false, invalidReason: "file missing" }); continue; }
    let info = specCache[s.blob];
    if (!info) {
      const file = join(tmp, `${s.blob}${extname(api.path)}`);
      await writeBlob(api, s.blob, file);
      info = inspectSpec(file);
      rmSync(file);
      specCache[s.blob] = info;
    }
    snapshots.push({ ...s, valid: info.valid, openapi: info.openapi, operations: info.operations, invalidReason: info.error });
  }
  writeJson(specCachePath, specCache);

  // Drop leading invalid snapshots (e.g. Square's Swagger 2.0 years): the timeline starts at the first readable spec.
  while (snapshots.length && !snapshots[0].valid) snapshots.shift();

  const pairs: Prepared["pairs"] = [];
  let prev: SnapshotOut | undefined;
  let sawInvalid = false;
  for (const s of snapshots) {
    if (!s.valid) { sawInvalid = true; continue; }
    if (prev) pairs.push({ from: prev, to: s, gap: sawInvalid });
    prev = s;
    sawInvalid = false;
  }
  log(`${api.id}: ${snapshots.length} snapshots, ${pairs.length} intervals`);
  return { api, snapshots, pairs, specCache, cacheDir };
}

/** Bump when diff.ts changes what it stores, so cached diffs are recomputed (and old ones pruned). */
const DIFF_VERSION = 3;

function diffCachePath(p: Prepared, from: SnapshotOut, to: SnapshotOut): string {
  return join(p.cacheDir, "diffs", `${short(from.blob!)}-${short(to.blob!)}.v${DIFF_VERSION}.json`);
}

async function runDiff(p: Prepared, from: SnapshotOut, to: SnapshotOut): Promise<void> {
  const out = diffCachePath(p, from, to);
  if (existsSync(out)) return;
  const tmp = join(TMP_DIR, p.api.id);
  const ext = extname(p.api.path);
  // Unique names: with several jobs running, one interval's revision is the next one's base.
  const a = join(tmp, `${short(from.blob!)}-${short(to.blob!)}.base${ext}`);
  const b = join(tmp, `${short(from.blob!)}-${short(to.blob!)}.rev${ext}`);
  await writeBlob(p.api, from.blob!, a);
  await writeBlob(p.api, to.blob!, b);
  const started = Date.now();
  const summary = await diffSpecs(a, b);
  rmSync(a);
  rmSync(b);
  // A timeout or OOM on the still-open month may just be a busy runner: leave it uncached so tomorrow retries.
  // On a closed month it's recorded, so a pathological pair (Stripe, spring 2019) isn't re-run every day.
  const transient = summary.error?.includes("ran out of") || summary.error?.includes("out of memory");
  if (!(transient && to.month === new Date().toISOString().slice(0, 7))) writeJson(out, summary, false);
  log(`${p.api.id} ${from.month}→${to.month}: ${summary.hard} hard, ${summary.soft} soft (${((Date.now() - started) / 1000).toFixed(0)}s)${summary.error ? " ERROR " + summary.error.slice(0, 120) : ""}`);
}

function summarize(p: Prepared, now: Date) {
  const nowMonth = now.toISOString().slice(0, 7);
  const used = new Set<string>();
  const intervals: Interval[] = p.pairs.map(({ from, to, gap }) => {
    const base = {
      from: from.month, to: to.month, fromCommit: from.commit, toCommit: to.commit,
      gap, partial: to.month === nowMonth, operations: to.operations ?? 0,
    };
    if (gap) return { ...base, hard: 0, soft: 0, info: 0, hardOperations: 0, changes: [] };
    const file = diffCachePath(p, from, to);
    used.add(file);
    const d = readJson<DiffSummary | null>(file, null);
    if (!d) return { ...base, hard: 0, soft: 0, info: 0, hardOperations: 0, changes: [], error: "not diffed" };
    return { ...base, hard: d.hard, soft: d.soft, info: d.info, hardOperations: d.hardOperations, changes: d.changes, repairedRefs: d.repairedRefs, error: d.error };
  });

  // Prune diffs for pairs that no longer exist (yesterday's partial month, mostly).
  const diffsDir = join(p.cacheDir, "diffs");
  if (existsSync(diffsDir)) {
    for (const f of readdirSync(diffsDir)) if (!used.has(join(diffsDir, f))) rmSync(join(diffsDir, f));
  }

  const counted = intervals.filter((i) => !i.gap && !i.error);
  const activity = counted.map((i) => ({ month: i.to, hard: i.hard, soft: i.soft, operations: i.operations }));
  const { score, pressure } = stabilityScore(activity, nowMonth);
  const inWindow = counted.filter((i) => { const age = monthsAgo(i.to, nowMonth); return age >= 0 && age < WINDOW_MONTHS; });

  const byYear: Record<string, { hard: number; soft: number; breakingMonths: number; changedMonths: number }> = {};
  for (const i of counted) {
    const y = (byYear[i.to.slice(0, 4)] ??= { hard: 0, soft: 0, breakingMonths: 0, changedMonths: 0 });
    y.hard += i.hard;
    y.soft += i.soft;
    y.changedMonths++;
    if (i.hard > 0) y.breakingMonths++;
  }
  const worst = [...counted].sort((a, b) => b.hard - a.hard)[0];
  const latest = p.snapshots.filter((s) => s.valid).at(-1);

  return {
    id: p.api.id,
    name: p.api.name,
    repo: p.api.repo,
    path: p.api.path,
    sourceUrl: `https://github.com/${p.api.repo}/blob/${p.api.branch}/${p.api.path}`,
    notes: p.api.notes,
    score: { value: score, pressure: Number(pressure.toFixed(3)), ...weatherLabel(score) },
    last12: {
      hard: inWindow.reduce((s, i) => s + i.hard, 0),
      soft: inWindow.reduce((s, i) => s + i.soft, 0),
      breakingMonths: inWindow.filter((i) => i.hard > 0).length,
      changedMonths: inWindow.length,
    },
    operations: latest?.operations ?? 0,
    openapi: latest?.openapi,
    firstMonth: p.snapshots[0]?.month,
    worstMonth: worst && worst.hard > 0 ? { month: worst.to, hard: worst.hard, hardOperations: worst.hardOperations } : null,
    byYear,
    gaps: intervals.filter((i) => i.gap).map((i) => ({ from: i.from, to: i.to })),
    snapshots: p.snapshots.map(({ month, commit, commitDate, valid, openapi, operations, invalidReason }) =>
      ({ month, commit, commitDate, valid, openapi, operations, invalidReason })),
    intervals,
  };
}

export type ApiData = ReturnType<typeof summarize>;

// ---------- main ----------

async function main() {
  const now = new Date();
  const apis = loadApis();
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });

  const prepared: Prepared[] = [];
  await pool(apis, CONCURRENCY, async (api) => { prepared.push(await prepare(api, now)); });

  const jobs = prepared.flatMap((p) => p.pairs.filter((x) => !x.gap).map((x) => ({ p, ...x })));
  const todo = jobs.filter((j) => !existsSync(diffCachePath(j.p, j.from, j.to)));
  log(`${jobs.length} intervals, ${todo.length} need diffing`);
  // Biggest specs first, so the long jobs don't all land at the end.
  todo.sort((a, b) => (b.to.operations ?? 0) - (a.to.operations ?? 0));
  await pool(todo, CONCURRENCY, (j) => runDiff(j.p, j.from, j.to));

  const all = prepared.map((p) => summarize(p, now)).sort((a, b) => apis.findIndex((x) => x.id === a.id) - apis.findIndex((x) => x.id === b.id));
  for (const d of all) writeJson(join(DATA_DIR, "apis", `${d.id}.json`), d, false);

  if (!process.env.ONLY) {
    const leaderboard = [...all]
      .sort((a, b) => b.score.value - a.score.value || a.last12.breakingMonths - b.last12.breakingMonths)
      .map((d, rank) => ({
        rank: rank + 1, id: d.id, name: d.name, score: d.score, last12: d.last12,
        operations: d.operations, worstMonth: d.worstMonth,
      }));
    writeJson(join(DATA_DIR, "leaderboard.json"), leaderboard);
    writeJson(join(DATA_DIR, "headlines.json"), buildHeadlines(all, now));
    const { stdout: version } = await run(OASDIFF, ["--version"]).catch(() => ({ stdout: "unknown" }));
    writeJson(join(DATA_DIR, "meta.json"), {
      generatedAt: now.toISOString(),
      oasdiff: version.trim(),
      score: { softWeight: SOFT_WEIGHT, halfLifeMonths: HALF_LIFE_MONTHS, windowMonths: WINDOW_MONTHS, k: K },
    });
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
