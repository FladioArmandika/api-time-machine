// The public data API's front door: every API with its current score and links to the rest.
import type { APIRoute } from "astro";
import { apis, leaderboard, meta } from "../../lib/data";
import { SITE } from "../../lib/feed";

export const GET: APIRoute = () => {
  const body = {
    version: 1,
    generatedAt: meta.generatedAt,
    oasdiff: meta.oasdiff,
    docs: `${SITE}/data/`,
    apis: leaderboard.map((r) => {
      const api = apis.find((a) => a.id === r.id)!;
      return {
        id: r.id,
        name: r.name,
        rank: r.rank,
        score: r.score.value,
        last12: r.last12,
        endpoints: r.operations,
        spec: api.sourceUrl,
        page: `${SITE}/api/${r.id}/`,
        data: `${SITE}/data/${r.id}.json`,
        feed: `${SITE}/feed/${r.id}.xml`,
        badge: `${SITE}/badge/${r.id}.svg`,
      };
    }),
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json" } });
};
