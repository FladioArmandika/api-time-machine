// Every tracked API's breaking changes in one RSS feed, newest first.
import type { APIRoute } from "astro";
import { apis } from "../lib/data";
import { SITE, feedItems, rss } from "../lib/feed";

export const GET: APIRoute = () => {
  const items = apis.flatMap(feedItems).sort((a, b) => b.date.getTime() - a.date.getTime() || a.title.localeCompare(b.title));
  return rss(
    "Breaking changes in popular APIs: API Weather",
    `Each month one of ${apis.length} popular APIs shipped a breaking change in its public OpenAPI spec.`,
    `${SITE}/`,
    `${SITE}/feed.xml`,
    items.slice(0, 100),
  );
};
