// Every breaking change on record, flattened for the search page. Fetched on demand, so it never weighs on other pages.
import type { APIRoute } from "astro";
import { apis } from "../lib/data";

export const GET: APIRoute = () => {
  const list = [...apis].sort((a, b) => a.name.localeCompare(b.name));
  const rows: [number, string, string, string[], number][] = [];
  list.forEach((api, a) => {
    for (const i of api.intervals) {
      if (i.gap || i.error) continue;
      for (const c of i.changes) if (c.level === "hard") rows.push([a, i.to, c.text, c.operations, c.operationCount]);
    }
  });
  rows.sort((x, y) => y[1].localeCompare(x[1]));
  const body = { apis: list.map((a) => ({ id: a.id, name: a.name })), rows };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
};
