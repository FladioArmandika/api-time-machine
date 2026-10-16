/**
 * Stability score, 0–100 (higher = calmer). See data/README.md for the write-up.
 *
 *   penalty(m) = (hard_m + 0.25 · soft_m) / (operations_m / 100)   per 100 operations, so size isn't punished
 *   B          = Σ over the trailing 12 months of 0.5^(age_m / 6) · penalty(m)   6-month half-life
 *   score      = round(100 · exp(−B / K))
 */

export const SOFT_WEIGHT = 0.25;
export const HALF_LIFE_MONTHS = 6;
export const WINDOW_MONTHS = 12;
/**
 * Calibrated once against the first full backfill (2026-10-16: median pressure ≈ 5.5 across the
 * 10 APIs, so K = 15 puts a typical API at ~70) and then frozen so scores stay comparable over time.
 */
export const K = 15;

export interface MonthActivity {
  month: string; // YYYY-MM
  hard: number;
  soft: number;
  operations: number;
}

export function monthsAgo(month: string, now: string): number {
  const [y, m] = month.split("-").map(Number);
  const [ny, nm] = now.split("-").map(Number);
  return (ny - y) * 12 + (nm - m);
}

export function penalty(a: MonthActivity): number {
  return (a.hard + SOFT_WEIGHT * a.soft) / Math.max(a.operations / 100, 0.1);
}

export function stabilityScore(activity: MonthActivity[], now: string): { score: number; pressure: number } {
  let pressure = 0;
  for (const a of activity) {
    const age = monthsAgo(a.month, now);
    if (age < 0 || age >= WINDOW_MONTHS) continue;
    pressure += 0.5 ** (age / HALF_LIFE_MONTHS) * penalty(a);
  }
  return { score: Math.round(100 * Math.exp(-pressure / K)), pressure };
}

export function weatherLabel(score: number): { label: string; icon: string } {
  if (score >= 85) return { label: "Clear", icon: "☀️" };
  if (score >= 70) return { label: "Fair", icon: "🌤" };
  if (score >= 50) return { label: "Showers", icon: "🌧" };
  return { label: "Storms", icon: "⛈" };
}
