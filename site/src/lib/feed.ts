// RSS 2.0 feeds of breaking changes: one item per API per month, so a reader hears about each month that broke something.
import { addMonths, meta, monthLong, plural, type ApiData } from "./data";

const SITE = "https://fladioarmandika.github.io/api-time-machine";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A closed month is dated at its end; the open one at the latest data refresh. */
const itemDate = (month: string, partial: boolean) =>
  partial ? new Date(meta.generatedAt) : new Date(`${addMonths(month, 1)}-01T00:00:00Z`);

export function feedItems(api: ApiData) {
  return api.intervals
    .filter((i) => !i.gap && !i.error && i.hard > 0)
    .map((i) => {
      const hard = i.changes.filter((c) => c.level === "hard" && !c.unstable);
      const link = `${SITE}/api/${api.id}/#m-${i.to}`;
      const list = hard
        .slice(0, 10)
        .map((c) => `<li>${c.operations[0] ? `<code>${esc(c.operations[0])}</code>${c.operationCount > 1 ? ` and ${plural(c.operationCount - 1, "more endpoint")}` : ""}: ` : ""}${esc(c.text.replace(/`/g, ""))}</li>`)
        .join("");
      const more = hard.length > 10 ? `<p>And ${plural(hard.length - 10, "more change")} on the site.</p>` : "";
      return {
        title: `${api.name}: ${plural(i.hard, "breaking change")} ${i.partial ? "so far in" : "in"} ${monthLong(i.to)}`,
        link,
        // The open month's count grows; a new guid per count lets readers pick up each increase.
        guid: `${api.id}-${i.to}-${i.hard}`,
        date: itemDate(i.to, i.partial),
        html: `<ul>${list}</ul>${more}`,
      };
    });
}

export function rss(title: string, description: string, link: string, self: string, items: ReturnType<typeof feedItems>) {
  const body = items
    .map(
      (it) => `<item>
<title>${esc(it.title)}</title>
<link>${esc(it.link)}</link>
<guid isPermaLink="false">${esc(it.guid)}</guid>
<pubDate>${it.date.toUTCString()}</pubDate>
<description>${esc(it.html)}</description>
</item>`,
    )
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(title)}</title>
<link>${esc(link)}</link>
<description>${esc(description)}</description>
<atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
<lastBuildDate>${new Date(meta.generatedAt).toUTCString()}</lastBuildDate>
${body}
</channel>
</rss>
`,
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
}

export { SITE };
