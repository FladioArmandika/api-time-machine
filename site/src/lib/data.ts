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
}

export interface Interval {
  from: string;
  to: string;
  gap: boolean;
  partial: boolean;
  operations: number;
  hard: number;
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

// ---------- intensity bins (the stripe colours) ----------

export type Bin = "before" | "gap" | "calm" | "b0" | "b1" | "b2" | "b3" | "b4";

/** b0 = soft changes only; b1..b4 = 1–4, 5–19, 20–99, 100+ breaking changes. */
export function binOf(c: MonthCell): Bin {
  if (c.state === "before" || c.state === "gap" || c.state === "calm") return c.state;
  if (c.state === "soft") return "b0";
  return c.hard >= 100 ? "b4" : c.hard >= 20 ? "b3" : c.hard >= 5 ? "b2" : "b1";
}

export const BINS: { bin: Bin; label: string }[] = [
  { bin: "b0", label: "Soft only" },
  { bin: "b1", label: "1–4" },
  { bin: "b2", label: "5–19" },
  { bin: "b3", label: "20–99" },
  { bin: "b4", label: "100+" },
];

/** Every month from the oldest tracked spec to now: the shared axis on the home page. */
export const allMonths = monthRange(apis.map((a) => a.firstMonth).sort()[0], nowMonth);
