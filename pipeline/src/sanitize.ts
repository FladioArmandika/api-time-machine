import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/**
 * Vendor specs are often slightly broken: a `$ref` to a schema that was deleted, a ref into a
 * file that isn't published, a request body pointing at a response. oasdiff (rightly) refuses
 * to load those. When that happens we write a repaired copy where each broken `$ref` becomes an
 * empty schema `{}`, refs that point *inside* another component (`#/components/schemas/Tag/allOf/0`,
 * which kin-openapi can't follow through a nested `$ref`) are inlined, and discriminator mappings
 * to unpublished files are dropped. Then we diff that copy instead. Changes inside the broken parts are invisible, so the
 * interval records how many refs were repaired.
 */

const KIND_BY_KEY: Record<string, string> = {
  requestBody: "requestBodies",
};

/** Resolves a local JSON pointer, following any `$ref` met on the way. */
function resolvePointer(doc: unknown, ref: string, depth = 0): unknown {
  if (depth > 20) return undefined;
  let node: any = doc;
  for (const raw of ref.slice(2).split("/")) {
    if (node && typeof node === "object" && typeof node.$ref === "string") {
      node = node.$ref.startsWith("#/") ? resolvePointer(doc, node.$ref, depth + 1) : undefined;
    }
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

const isDeep = (ref: string) => ref.split("/").length > 4; // deeper than #/components/<kind>/<name>

/** The components kind a ref at this location must point into, when we can tell. */
function expectedKind(path: string[]): string | undefined {
  const last = path.at(-1);
  const parent = path.at(-2);
  if (path[0] === "components" && path.length === 3) return path[1];
  if (last && KIND_BY_KEY[last]) return KIND_BY_KEY[last];
  if (parent === "responses") return "responses";
  if (parent === "parameters") return "parameters";
  return undefined;
}

export function sanitizeSpec(src: string, dest: string): number {
  const text = readFileSync(src, "utf8");
  const doc = /\.ya?ml$/.test(src) ? parseYaml(text, { maxAliasCount: -1 }) : JSON.parse(text);
  let repaired = 0;

  // Resolve against the untouched original, so inlining doesn't see half-repaired nodes.
  const original = structuredClone(doc);

  const walk = (node: any, path: string[], depth: number): any => {
    if (Array.isArray(node)) return node.map((v, i) => walk(v, [...path, String(i)], depth));
    if (node === null || typeof node !== "object") return node;
    if (typeof node.$ref === "string") {
      const ref: string = node.$ref;
      const kind = expectedKind(path);
      const target = ref.startsWith("#/") ? resolvePointer(original, ref) : undefined;
      if (target === undefined || (kind && !ref.startsWith(`#/components/${kind}/`))) { repaired++; return {}; }
      if (isDeep(ref)) {
        repaired++;
        return depth > 8 ? {} : walk(structuredClone(target), path, depth + 1);
      }
      return node;
    }
    if (node.discriminator?.mapping) {
      for (const [k, v] of Object.entries<string>(node.discriminator.mapping)) {
        if (typeof v !== "string" || !v.startsWith("#/") || resolvePointer(original, v) === undefined || isDeep(v)) {
          delete node.discriminator.mapping[k];
          repaired++;
        }
      }
    }
    for (const k of Object.keys(node)) node[k] = walk(node[k], [...path, k], depth);
    return node;
  };

  writeFileSync(dest, JSON.stringify(walk(doc, [], 0)));
  return repaired;
}
