// Every breaking change on record, flattened for the search page. Fetched on demand, so it never weighs on other pages.
// Endpoints are stored once per API; each change lists every endpoint it touched by index into that list.
import type { APIRoute } from "astro";
import { apis } from "../lib/data";

export const GET: APIRoute = () => {
  const list = [...apis].sort((a, b) => a.name.localeCompare(b.name));
  const rows: [number, string, string, number[], 0 | 1][] = [];
  const endpoints = list.map((api, a) => {
    // Older data has no endpoint list, only up to five example operations per change.
    const eps = [...(api.endpoints ?? [])];
    const idx = new Map(eps.map((e, i) => [e, i]));
    const idOf = (op: string) => idx.get(op) ?? (idx.set(op, eps.push(op) - 1), eps.length - 1);
    for (const i of api.intervals) {
      if (i.gap || i.error) continue;
      for (const c of i.changes) {
        if (c.level !== "hard") continue;
        rows.push([a, i.to, c.text, c.opIds ?? c.operations.map(idOf), c.unstable ? 1 : 0]);
      }
    }
    return eps;
  });
  rows.sort((x, y) => y[1].localeCompare(x[1]));
  const body = { apis: list.map((a, i) => ({ id: a.id, name: a.name, endpoints: endpoints[i] })), rows };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
};
