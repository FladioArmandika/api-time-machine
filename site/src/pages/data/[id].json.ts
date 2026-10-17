// One API's full record, exactly as the pipeline wrote it.
import type { APIRoute } from "astro";
import { apis, type ApiData } from "../../lib/data";

export function getStaticPaths() {
  return apis.map((api) => ({ params: { id: api.id }, props: { api } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify((props as { api: ApiData }).api), { headers: { "Content-Type": "application/json" } });
