import type { APIRoute } from "astro";
import { apis, monthRange, nowMonth, plural, type ApiData } from "../../lib/data";
import { C, bars, frame, h, png } from "../../lib/og";

export function getStaticPaths() {
  return apis.map((api) => ({ params: { id: api.id }, props: { api } }));
}

export const GET: APIRoute = async ({ props }) => {
  const api = (props as { api: ApiData }).api;
  const byMonth = new Map(api.intervals.filter((i) => !i.gap && !i.error).map((i) => [i.to, i.hard]));
  const values = monthRange(api.firstMonth, nowMonth).map((m) => byMonth.get(m) ?? 0);
  const l12 = api.last12;
  const line =
    l12.breakingMonths === 0
      ? "No breaking changes in the last 12 months."
      : `${plural(l12.hard, "breaking change")} in the past year, across ${l12.breakingMonths} of 12 months.`;
  const card = frame(
    h(
      "div",
      { marginTop: 40, justifyContent: "space-between", alignItems: "flex-end" },
      h("div", { fontSize: 96, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }, api.name),
      h(
        "div",
        { alignItems: "baseline" },
        h("div", { fontSize: 96, fontWeight: 600, letterSpacing: -3, lineHeight: 1 }, String(api.score.value)),
        h("div", { fontSize: 30, color: C.ink3, marginLeft: 8 }, "/100"),
      ),
    ),
    h("div", { marginTop: 18, fontSize: 32, color: C.ink2, letterSpacing: -0.5 }, line),
    h("div", { flexGrow: 1 }),
    bars(values, 170, { gap: values.length > 80 ? 2 : 3 }),
    h("div", { marginTop: 14, fontSize: 22, color: C.ink3 }, `Breaking changes per month since ${api.firstMonth.slice(0, 4)}`),
  );
  return new Response(await png(card), { headers: { "Content-Type": "image/png" } });
};
