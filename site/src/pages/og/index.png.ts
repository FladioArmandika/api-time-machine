import type { APIRoute } from "astro";
import { apis, heroSeries } from "../../lib/data";
import { C, bars, frame, h, png } from "../../lib/og";

export const GET: APIRoute = async () => {
  const hero = heroSeries();
  const card = frame(
    h(
      "div",
      { marginTop: 44, fontSize: 64, fontWeight: 600, lineHeight: 1.08, letterSpacing: -2.2, maxWidth: 1072 },
      `${apis.length} popular APIs shipped ${hero.last12.toLocaleString("en-US")} breaking changes in the past year.`,
    ),
    h("div", { flexGrow: 1 }),
    bars(hero.cols.map((c) => c.total), 190, { gap: 5, outlineLast: true }),
    h(
      "div",
      { marginTop: 14, fontSize: 22, color: C.ink3 },
      `Breaking changes per month across Stripe, GitHub, OpenAI, Cloudflare and ${apis.length - 4} more`,
    ),
  );
  return new Response(await png(card), { headers: { "Content-Type": "image/png" } });
};
