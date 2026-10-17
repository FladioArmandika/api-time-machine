// One API's breaking changes as an RSS feed, newest month first.
import type { APIRoute } from "astro";
import { apis, type ApiData } from "../../lib/data";
import { SITE, feedItems, rss } from "../../lib/feed";

export function getStaticPaths() {
  return apis.map((api) => ({ params: { id: api.id }, props: { api } }));
}

export const GET: APIRoute = ({ props }) => {
  const api = (props as { api: ApiData }).api;
  return rss(
    `${api.name} breaking changes: API Weather`,
    `Each month ${api.name}'s public OpenAPI spec shipped a breaking change.`,
    `${SITE}/api/${api.id}/`,
    `${SITE}/feed/${api.id}.xml`,
    feedItems(api).reverse().slice(0, 50),
  );
};
