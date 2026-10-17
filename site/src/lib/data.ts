// Everything the site shows comes from ../data, written by the pipeline. Read at build time only.
import leaderboardJson from "../../../data/leaderboard.json";
import headlinesJson from "../../../data/headlines.json";
import metaJson from "../../../data/meta.json";

export interface Change {
  id: string;
  level: "hard" | "soft";
  text: string;
  occurrences: number;
  operationCount: number;
  operations: string[];
  enumValueCount?: number;
  enumValues?: string[];
  /** Index into the API's `endpoints` for every affected operation. */
  opIds?: number[];
  /** Every affected operation is one the vendor marks beta or unstable; not counted as breaking. */
  unstable?: true;
}

export interface Interval {
  from: string;
  to: string;
  gap: boolean;
  partial: boolean;
  operations: number;
  hard: number;
  /** Hard changes confined to beta or unstable operations; not in `hard`. */
  hardUnstable?: number;
  soft: number;
  info: number;
  hardOperations: number;
  changes: Change[];
  repairedRefs?: number;
  error?: string;
}

export interface Score {
  value: number;
  pressure: number;
  label: string;
  icon: string;
}

export interface Window12 {
  hard: number;
  hardUnstable?: number;
  soft: number;
  breakingMonths: number;
  changedMonths: number;
}

export interface ApiData {
  id: string;
  name: string;
  repo: string;
  path: string;
  sourceUrl: string;
  notes?: string;
  score: Score;
  last12: Window12;
  operations: number;
  openapi?: string;
  firstMonth: string;
  worstMonth: { month: string; hard: number; hardOperations: number } | null;
  byYear: Record<string, { hard: number; soft: number; breakingMonths: number; changedMonths: number }>;
  gaps: { from: string; to: string }[];
  /** Every endpoint a change touched; changes refer to these by index. */
  endpoints?: string[];
  intervals: Interval[];
}

export interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  score: Score;
  last12: Window12;
  operations: number;
  worstMonth: ApiData["worstMonth"];
}

export interface Headline {
  id: string;
  apiId?: string;
  text: string;
  figure?: string;
}

const apiModules = import.meta.glob<{ default: ApiData }>("../../../data/apis/*.json", { eager: true });

export const apis: ApiData[] = Object.values(apiModules).map((m) => m.default);
export const apiById = (id: string) => apis.find((a) => a.id === id)!;
export const leaderboard = leaderboardJson as LeaderboardRow[];
export const headlines = headlinesJson as Headline[];
export const meta = metaJson as { generatedAt: string; oasdiff: string; score: Record<string, number> };

export const REPO_URL = "https://github.com/FladioArmandika/api-time-machine";
export const nowMonth = meta.generatedAt.slice(0, 7);

// ---------- months ----------

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

const fmt = (month: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { ...opts, timeZone: "UTC" });
};
export const monthLong = (month: string) => fmt(month, { month: "long", year: "numeric" });
export const monthShort = (month: string) => fmt(month, { month: "short" });
export const monthShortYear = (month: string) => fmt(month, { month: "short", year: "numeric" });

export const updatedOn = new Date(meta.generatedAt).toLocaleDateString("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

// ---------- per-month state ----------

export type MonthState = "hard" | "soft" | "calm" | "gap" | "before";

export interface MonthCell {
  month: string;
  state: MonthState;
  hard: number;
  soft: number;
  partial: boolean;
}

/** One cell per month: what happened to the spec in that month. */
export function monthCells(api: ApiData, months: string[]): MonthCell[] {
  const byMonth = new Map(api.intervals.map((i) => [i.to, i]));
  const gapMonths = new Set<string>();
  for (const i of api.intervals) {
    if (i.gap || i.error) for (const m of monthRange(addMonths(i.from, 1), i.to)) gapMonths.add(m);
  }
  return months.map((month) => {
    const i = byMonth.get(month);
    const partial = month === nowMonth;
    if (month < api.firstMonth) return { month, state: "before", hard: 0, soft: 0, partial };
    if (gapMonths.has(month)) return { month, state: "gap", hard: 0, soft: 0, partial };
    if (!i) return { month, state: "calm", hard: 0, soft: 0, partial };
    return { month, state: i.hard > 0 ? "hard" : i.soft > 0 ? "soft" : "calm", hard: i.hard, soft: i.soft, partial };
  });
}

export const last12Months = monthRange(addMonths(nowMonth, -11), nowMonth);

// ---------- text ----------

const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
export { plural };

export function cellLabel(c: MonthCell): string {
  const when = monthLong(c.month) + (c.partial ? " so far" : "");
  switch (c.state) {
    case "hard": return `${when}: ${plural(c.hard, "breaking change")}${c.soft ? `, ${plural(c.soft, "soft change")}` : ""}`;
    case "soft": return `${when}: ${plural(c.soft, "soft change")}, nothing breaking`;
    case "gap": return `${when}: no readable spec`;
    case "before": return `${when}: not published yet`;
    default: return `${when}: no breaking or soft changes`;
  }
}

/** "request-property-enum-value-removed" → "Request property enum value removed" */
export function ruleName(id: string): string {
  const s = id.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Splits oasdiff text on backticks so the template can set identifiers as code. */
export function codeParts(text: string): { code: boolean; text: string }[] {
  return text.split("`").map((t, i) => ({ code: i % 2 === 1, text: t })).filter((p) => p.text !== "" || p.code);
}

export function rawJsonUrl(api: ApiData) {
  return `${REPO_URL}/blob/main/data/apis/${api.id}.json`;
}

// ---------- home page ----------

/** Every month from the oldest tracked spec to now: the shared axis for the small multiples. */
export const allMonths = monthRange(apis.map((a) => a.firstMonth).sort()[0], nowMonth);
export const lastFullMonth = addMonths(nowMonth, -1);

/** One representative breaking change per API from the last full month, biggest months first. */
export function lastMonthBreaks() {
  return apis
    .map((api) => {
      const i = api.intervals.find((x) => x.to === lastFullMonth && !x.gap && !x.error && x.hard > 0);
      if (!i) return null;
      const hard = i.changes.filter((c) => c.level === "hard" && !c.unstable && c.operations.length > 0);
      const pick = [...hard].sort(
        (a, b) =>
          Number(!b.text.includes("…")) - Number(!a.text.includes("…")) ||
          Number(b.id.includes("removed")) - Number(a.id.includes("removed")) ||
          b.operationCount - a.operationCount,
      )[0];
      return pick ? { api, count: i.hard, change: pick } : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => b!.count - a!.count) as { api: ApiData; count: number; change: Change }[];
}

/** The contrast the home page leads with: most and least breaking over the last 12 months. */
export function leadSentence() {
  const by = [...apis].sort((a, b) => b.last12.breakingMonths - a.last12.breakingMonths || b.last12.hard - a.last12.hard);
  const worst = by[0];
  const best = by.at(-1)!;
  const w = worst.last12.breakingMonths;
  const b = best.last12.breakingMonths;
  return {
    worst,
    best,
    first: w === 12 ? `${worst.name} shipped a breaking change every month.` : `${worst.name} shipped breaking changes in ${w} of 12 months.`,
    second: b === 0 ? `${best.name} didn't ship any.` : `${best.name} did in only ${b}.`,
  };
}

/** Breaking changes per month across every API, from the first month all of them had a public spec. */
export function heroSeries() {
  const start = apis.map((a) => a.firstMonth).sort().at(-1)!;
  const months = monthRange(start, nowMonth);
  const perApi = apis
    .map((api) => {
      const by = new Map(api.intervals.filter((i) => !i.gap && !i.error).map((i) => [i.to, i.hard]));
      return { api, by, sum: months.reduce((n, m) => n + (by.get(m) ?? 0), 0) };
    })
    // Biggest contributors sit at the base of every column so the stack reads the same way all along.
    .sort((a, b) => b.sum - a.sum);
  const cols = months.map((m) => {
    const segs = perApi.map(({ api, by }) => ({ api, n: by.get(m) ?? 0 })).filter((s) => s.n > 0);
    return { m, segs, total: segs.reduce((n, s) => n + s.n, 0), partial: m === nowMonth };
  });
  const full = cols.filter((c) => !c.partial);
  const peak = full.reduce((a, b) => (b.total > a.total ? b : a));
  return {
    start,
    cols,
    peak,
    /** Every API with its total over the charted months, in stack order (largest first). */
    order: perApi.map(({ api, sum }) => ({ api, sum })),
    top: Math.max(...cols.map((c) => c.total)),
    last12: full.slice(-12).reduce((n, c) => n + c.total, 0),
  };
}
