// README badges in the familiar flat style: "API stability | 64/100", coloured by score band.
import type { APIRoute } from "astro";
import { apis, type ApiData } from "../../lib/data";

export function getStaticPaths() {
  return apis.map((api) => ({ params: { id: api.id }, props: { api } }));
}

// Approximate Verdana 11px advance widths, close enough for badge sizing.
const textWidth = (s: string) => [...s].reduce((w, c) => w + (/[ilI.,:;|!'1]/.test(c) ? 3.7 : /[mwMW]/.test(c) ? 9.6 : /[A-Z0-9/]/.test(c) ? 7.4 : 6.4), 0);
const colour = (v: number) => (v >= 85 ? "#1a7f37" : v >= 50 ? "#9a6700" : "#cf222e");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function badgeSvg(label: string, value: string, fill: string) {
  const lw = Math.round(textWidth(label) + 12);
  const vw = Math.round(textWidth(value) + 12);
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${fill}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(value)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text>
</g></svg>`;
}

export const GET: APIRoute = ({ props }) => {
  const api = (props as { api: ApiData }).api;
  const svg = badgeSvg(`${api.name} API stability`, `${api.score.value}/100`, colour(api.score.value));
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
};
