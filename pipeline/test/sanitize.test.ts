import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sanitizeSpec } from "../src/sanitize.ts";

function repair(spec: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "aw-"));
  const src = join(dir, "in.json");
  const dest = join(dir, "out.json");
  writeFileSync(src, JSON.stringify(spec));
  const count = sanitizeSpec(src, dest);
  return { count, doc: JSON.parse(readFileSync(dest, "utf8")) };
}

const ok = { description: "ok" };

test("a ref to a missing schema becomes an empty schema", () => {
  const { count, doc } = repair({
    openapi: "3.0.0",
    paths: { "/a": { get: { responses: { 200: { ...ok, content: { "application/json": { schema: { $ref: "#/components/schemas/Gone" } } } } } } } },
    components: { schemas: {} },
  });
  assert.equal(count, 1);
  assert.deepEqual(doc.paths["/a"].get.responses["200"].content["application/json"].schema, {});
});

test("valid refs are left alone", () => {
  const spec = {
    openapi: "3.0.0",
    paths: { "/a": { get: { responses: { 200: { ...ok, content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } } } } } },
    components: { schemas: { A: { type: "string" } } },
  };
  const { count, doc } = repair(spec);
  assert.equal(count, 0);
  assert.deepEqual(doc, spec);
});

test("a ref into another component is inlined", () => {
  const { count, doc } = repair({
    openapi: "3.0.0",
    paths: {},
    components: {
      schemas: {
        Tag: { allOf: [{ type: "object", properties: { name: { type: "string" } } }] },
        Uses: { properties: { tag: { $ref: "#/components/schemas/Tag/allOf/0" } } },
      },
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(doc.components.schemas.Uses.properties.tag, { type: "object", properties: { name: { type: "string" } } });
});

test("discriminator mappings to unpublished files are dropped", () => {
  const { count, doc } = repair({
    openapi: "3.0.0",
    paths: {},
    components: {
      schemas: {
        Cat: { type: "object" },
        Pet: { oneOf: [{ $ref: "#/components/schemas/Cat" }], discriminator: { propertyName: "kind", mapping: { cat: "#/components/schemas/Cat", dog: "./dog.yaml" } } },
      },
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(doc.components.schemas.Pet.discriminator.mapping, { cat: "#/components/schemas/Cat" });
});
