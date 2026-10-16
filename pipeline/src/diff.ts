import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { OASDIFF, SEVERITY_LEVELS } from "./config.ts";
import { sanitizeSpec } from "./sanitize.ts";

const run = promisify(execFile);
const PRLIMIT = existsSync("/usr/bin/prlimit");
const MAX_BYTES = Number(process.env.OASDIFF_MAX_GB ?? 10) * 1024 ** 3;

const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export interface SpecInfo {
  /** false when the file isn't an OpenAPI 3 document oasdiff can read (e.g. Swagger 2.0). */
  valid: boolean;
  openapi?: string;
  operations?: number;
  error?: string;
}

export function inspectSpec(file: string): SpecInfo {
  try {
    const text = readFileSync(file, "utf8");
    const doc = /\.ya?ml$/.test(file) ? parseYaml(text, { maxAliasCount: -1 }) : JSON.parse(text);
    const openapi: unknown = doc?.openapi;
    if (typeof openapi !== "string" || !openapi.startsWith("3.")) {
      return { valid: false, error: doc?.swagger ? `Swagger ${doc.swagger}` : "not an OpenAPI 3 document" };
    }
    let operations = 0;
    for (const item of Object.values<Record<string, unknown>>(doc.paths ?? {})) {
      for (const key of Object.keys(item ?? {})) if (METHODS.has(key)) operations++;
    }
    return { valid: true, openapi, operations };
  } catch (e) {
    return { valid: false, error: `unparseable: ${(e as Error).message.slice(0, 200)}` };
  }
}

/** oasdiff levels: 3 = ERR (hard break), 2 = WARN (soft break, incl. our downgrades), 1 = INFO. */
interface OasdiffChange {
  id: string;
  text: string;
  level: 1 | 2 | 3;
  operation?: string;
  path?: string;
  section?: string;
}

export interface Change {
  id: string;
  level: "hard" | "soft";
  /** oasdiff's text with schema paths shortened, so one schema change reported on 500 endpoints reads as one change. */
  text: string;
  /** How many raw oasdiff findings collapsed into this one. */
  occurrences: number;
  /** Number of distinct operations affected. */
  operationCount: number;
  /** Up to 5 example operations, "GET /v1/customers". */
  operations: string[];
  /** For enum changes: how many values were added/removed, and up to 10 of them. */
  enumValueCount?: number;
  enumValues?: string[];
}

export interface DiffSummary {
  hard: number;
  soft: number;
  info: number;
  /** Raw oasdiff findings before de-duplication, by level. */
  raw: { hard: number; soft: number; info: number };
  /** Distinct operations with at least one hard break. */
  hardOperations: number;
  changes: Change[];
  /** Broken `$ref`s replaced with empty schemas so oasdiff could load the specs (see sanitize.ts). */
  repairedRefs?: number;
  error?: string;
}

/** `data/items/payment_method_types/items/` → `payment_method_types` */
function lastSegment(path: string): string {
  if (!path.includes("/")) return path;
  const parts = path.split("/").filter(Boolean);
  while (parts.length > 1 && parts.at(-1) === "items") parts.pop();
  return parts.at(-1) ?? path;
}

/** The enum value an enum-value finding is about (its first backticked token). */
function enumValue(id: string, text: string): string | undefined {
  return id.includes("enum-value") ? /`([^`]*)`/.exec(text)?.[1] : undefined;
}

/**
 * Schema changes are reported once per operation and per nesting path
 * (`data/items/customer/anyOf[...]/address/city`). Keeping only the last path segment of each
 * backticked token, and dropping the response status / media type, groups those into one change.
 */
export function normalizeText(id: string, text: string): string {
  // "removed the enum value `a`…", "`b`…": one change per property, with the values listed separately.
  if (id.includes("enum-value")) text = text.replace(/`[^`]*`/, "`…`");
  return text
    .replace(/`([^`]*)`/g, (_, inner: string) => "`" + lastSegment(inner) + "`")
    .replace(/ for the (response )?status `[^`]*`/g, "")
    .replace(/ \(media type: [^)]*\)/g, "")
    .trim();
}

async function oasdiff(base: string, revision: string, extra: string[] = []): Promise<OasdiffChange[]> {
  // prlimit caps oasdiff's address space (OASDIFF_MAX_GB, default 10) so a runaway diff fails on its own
  // instead of getting the whole job OOM-killed. Falls back to plain oasdiff where prlimit is missing.
  const args = ["changelog", base, revision, "--format", "json", "--severity-levels", SEVERITY_LEVELS, ...extra];
  const [cmd, argv] = PRLIMIT ? ["prlimit", [`--as=${MAX_BYTES}`, OASDIFF, ...args]] : [OASDIFF, args];
  const { stdout } = await run(
    cmd,
    argv,
    // A few historical pairs make oasdiff balloon past 14 GB (Stripe, spring 2019). Cap the time
    // so one pathological pair can't take down a CI runner; it's recorded as an error interval.
    { maxBuffer: 1024 * 1024 * 1024, timeout: 120_000, killSignal: "SIGKILL" },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

const errorText = (e: unknown) => {
  const err = e as Error & { stderr?: string; signal?: string };
  return (err.stderr?.trim() || (err.signal ? "oasdiff ran out of time or memory on this pair" : "") || err.message).slice(0, 500);
};

export async function diffSpecs(base: string, revision: string): Promise<DiffSummary> {
  let findings: OasdiffChange[];
  let repairedRefs: number | undefined;
  try {
    findings = await oasdiff(base, revision);
  } catch (first) {
    const msg = errorText(first);
    if (!/failed to load|duplicate endpoint/.test(msg) || /out of memory|ran out of/.test(msg)) return emptySummary(msg);
    // Retry once on repaired copies. Duplicate endpoints (paths that differ only in parameter names)
    // need --include-path-params so oasdiff can tell them apart.
    const a = base.replace(/(\.[^.]+)$/, ".fixed.json");
    const b = revision.replace(/(\.[^.]+)$/, ".fixed.json");
    try {
      repairedRefs = sanitizeSpec(base, a) + sanitizeSpec(revision, b);
      findings = await oasdiff(a, b, /duplicate endpoint/.test(msg) ? ["--include-path-params"] : []);
    } catch (second) {
      const again = errorText(second);
      if (!/duplicate endpoint/.test(again)) return emptySummary(again);
      try {
        findings = await oasdiff(a, b, ["--include-path-params"]);
      } catch (third) {
        return emptySummary(errorText(third));
      }
    } finally {
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
  }

  const raw = { hard: 0, soft: 0, info: 0 };
  const hardOps = new Set<string>();
  const groups = new Map<string, { change: Change; ops: Set<string>; values: Set<string> }>();

  for (const f of findings) {
    if (f.level === 1) { raw.info++; continue; }
    const level = f.level === 3 ? "hard" : "soft";
    raw[level]++;
    const op = f.operation && f.path ? `${f.operation} ${f.path}` : undefined;
    if (level === "hard" && op) hardOps.add(op);

    const text = normalizeText(f.id, f.text);
    const key = `${f.id}\u0000${text}`;
    let g = groups.get(key);
    if (!g) {
      g = { change: { id: f.id, level, text, occurrences: 0, operationCount: 0, operations: [] }, ops: new Set(), values: new Set() };
      groups.set(key, g);
    }
    g.change.occurrences++;
    if (op) g.ops.add(op);
    const value = enumValue(f.id, f.text);
    if (value !== undefined) g.values.add(value);
  }

  const changes = [...groups.values()].map(({ change, ops, values }) => ({
    ...change,
    operationCount: ops.size,
    operations: [...ops].slice(0, 5),
    ...(values.size ? { enumValueCount: values.size, enumValues: [...values].slice(0, 10) } : {}),
  }));
  changes.sort((a, b) => (a.level === b.level ? b.operationCount - a.operationCount : a.level === "hard" ? -1 : 1));

  return {
    hard: changes.filter((c) => c.level === "hard").length,
    soft: changes.filter((c) => c.level === "soft").length,
    info: raw.info,
    raw,
    hardOperations: hardOps.size,
    changes,
    ...(repairedRefs ? { repairedRefs } : {}),
  };
}

function emptySummary(error: string): DiffSummary {
  return { hard: 0, soft: 0, info: 0, raw: { hard: 0, soft: 0, info: 0 }, hardOperations: 0, changes: [], error };
}
