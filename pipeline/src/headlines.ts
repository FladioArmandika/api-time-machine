import type { ApiData } from "./build.ts";

export interface Headline {
  id: string;
  apiId?: string;
  text: string;
  /** The number the sentence hangs on, for the site to set large. */
  figure?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Turns the numbers into sentences. The site leads with these; ordering is most striking first. */
export function buildHeadlines(apis: ApiData[], now: Date): Headline[] {
  const out: Headline[] = [];
  const year = String(now.getUTCFullYear());
  const ranked = [...apis].sort((a, b) => b.score.value - a.score.value);

  const stormiest = [...apis].sort((a, b) => b.last12.breakingMonths - a.last12.breakingMonths || b.last12.hard - a.last12.hard)[0];
  if (stormiest && stormiest.last12.breakingMonths > 0) {
    out.push({
      id: "most-break-months",
      apiId: stormiest.id,
      figure: `${stormiest.last12.breakingMonths}/12`,
      text: `${stormiest.name} shipped a breaking change in ${stormiest.last12.breakingMonths} of the last 12 months.`,
    });
  }

  const worst = apis.filter((a) => a.worstMonth).sort((a, b) => b.worstMonth!.hard - a.worstMonth!.hard)[0];
  if (worst?.worstMonth) {
    out.push({
      id: "worst-month",
      apiId: worst.id,
      figure: String(worst.worstMonth.hard),
      text: `The single roughest month on record: ${worst.name} in ${monthName(worst.worstMonth.month)}, with ${plural(worst.worstMonth.hard, "breaking change")} across ${plural(worst.worstMonth.hardOperations, "endpoint")}.`,
    });
  }

  const calmest = ranked[0];
  if (calmest) {
    out.push({
      id: "calmest",
      apiId: calmest.id,
      figure: String(calmest.score.value),
      text: calmest.last12.breakingMonths === 0
        ? `${calmest.name} hasn't shipped a breaking change in 12 months.`
        : `${calmest.name} is the calmest API we track, with breaking changes in only ${plural(calmest.last12.breakingMonths, "month")} this past year.`,
    });
  }

  const softHeavy = [...apis].sort((a, b) => b.last12.soft - a.last12.soft)[0];
  if (softHeavy && softHeavy.last12.soft > 0) {
    out.push({
      id: "most-soft",
      apiId: softHeavy.id,
      figure: String(softHeavy.last12.soft),
      text: `${softHeavy.name} made ${plural(softHeavy.last12.soft, "\"soft\" change")} in a year: new enum values and response types that strict clients can trip on.`,
    });
  }

  const thisYear = apis
    .map((a) => ({ a, y: a.byYear[year] }))
    .filter((x) => x.y && x.y.hard > 0)
    .sort((x, y) => y.y.hard - x.y.hard)[0];
  if (thisYear) {
    out.push({
      id: "this-year",
      apiId: thisYear.a.id,
      figure: String(thisYear.y.hard),
      text: `${thisYear.a.name} leads ${year} with ${plural(thisYear.y.hard, "breaking change")} so far.`,
    });
  }

  return out;
}
