// Link-preview cards (1200×630 PNG), drawn with satori and rasterised with resvg at build time.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const font = (w: number) =>
  readFileSync(require.resolve(`@fontsource/geist-sans/files/geist-sans-latin-${w}-normal.woff`));
const fonts = [
  { name: "Geist", data: font(400), weight: 400 as const, style: "normal" as const },
  { name: "Geist", data: font(600), weight: 600 as const, style: "normal" as const },
];

export const W = 1200;
export const H = 630;
export const C = { bg: "#ffffff", ink: "#1b1f24", ink2: "#4b525b", ink3: "#6e7681", rule: "#e1e4e8", red: "#cf222e" };

type Node = { type: string; props: Record<string, unknown> };
/** Tiny element helper, so cards can be written without JSX. */
export const h = (type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node => ({
  type,
  props: { style: { display: "flex", ...style }, children: children.filter((c) => c !== null && c !== false) },
});

/** Bars along the bottom of a card: one per value, scaled to the largest. */
export function bars(values: number[], height: number, opts: { gap?: number; outlineLast?: boolean } = {}) {
  const max = Math.max(1, ...values);
  const gap = opts.gap ?? 4;
  return h(
    "div",
    { alignItems: "flex-end", height, width: "100%", borderBottom: `2px solid ${C.ink}` },
    ...values.map((v, i) => {
      const last = opts.outlineLast && i === values.length - 1;
      return h("div", {
        flexGrow: 1,
        flexBasis: 0,
        marginLeft: i === 0 ? 0 : gap,
        height: v > 0 ? Math.max(3, (v / max) * height) : 0,
        backgroundColor: last ? "transparent" : C.red,
        border: last ? `2px solid ${C.red}` : "none",
        borderBottom: "none",
      });
    }),
  );
}

export async function png(node: Node) {
  const svg = await satori(node as never, { width: W, height: H, fonts });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}

export function frame(...children: Node[]) {
  return h(
    "div",
    { width: W, height: H, flexDirection: "column", backgroundColor: C.bg, padding: "56px 64px", fontFamily: "Geist", color: C.ink },
    h(
      "div",
      { justifyContent: "space-between", fontSize: 26, fontWeight: 600, letterSpacing: -0.5 },
      h("div", {}, "API Weather"),
      h("div", { color: C.ink3, fontWeight: 400 }, "fladioarmandika.github.io/api-time-machine"),
    ),
    ...children,
  );
}
