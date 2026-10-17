import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OASDIFF } from "../src/config.ts";
import { diffSpecs, inspectSpec, isUnstable, normalizeText, pathGroups, unstableOperations } from "../src/diff.ts";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);
const hasOasdiff = (() => {
  try {
    execFileSync(OASDIFF, ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

test("normalizeText keeps only the last segment of schema paths", () => {
  assert.equal(
    normalizeText("response-property-removed", "removed the optional property `data/items/customer/address/city` from the response with the `200` status"),
    "removed the optional property `city` from the response with the `200` status",
  );
});

test("normalizeText drops nested items segments", () => {
  assert.equal(normalizeText("x", "the `data/payment_method_types/items/` property"), "the `payment_method_types` property");
});

test("normalizeText drops the response status and media type", () => {
  assert.equal(
    normalizeText("x", "the `a/b` response's property type changed for the response status `default` (media type: application/json)"),
    "the `b` response's property type changed",
  );
});

test("normalizeText groups enum value changes by property, not by value", () => {
  const a = normalizeText("response-property-enum-value-removed", "removed the enum value `saturday` of the response property `days`");
  const b = normalizeText("response-property-enum-value-removed", "removed the enum value `sunday` of the response property `days`");
  assert.equal(a, b);
  assert.match(a, /`…`/);
});

test("isUnstable reads each vendor's preview marker", () => {
  assert.ok(isUnstable({ "x-unstable": "This endpoint is in Preview." })); // Datadog
  assert.ok(isUnstable({ "x-stability": "beta" })); // Cloudflare
  assert.ok(isUnstable({ "x-stability-level": "alpha" })); // Box
  assert.ok(isUnstable({ "x-okta-lifecycle": { lifecycle: "EA" } })); // Okta
  assert.ok(isUnstable({ "x-sentry-experimental": true })); // Sentry
  assert.ok(isUnstable({ "x-github": { previews: [{ name: "squirrel-girl" }] } })); // GitHub
});

test("isUnstable treats stable and generally available endpoints as stable", () => {
  assert.ok(!isUnstable({}));
  assert.ok(!isUnstable({ "x-stability-level": "stable" }));
  assert.ok(!isUnstable({ "x-okta-lifecycle": { lifecycle: "GA" } }));
  assert.ok(!isUnstable({ "x-okta-lifecycle": { lifecycle: "LIMITED_GA" } }));
  assert.ok(!isUnstable({ "x-github": { previews: [], category: "repos" } }));
  assert.ok(!isUnstable({ "x-sentry-experimental": false }));
});

test("unstableOperations lists marked operations, including path-level markers", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-"));
  const file = join(dir, "spec.json");
  writeFileSync(
    file,
    JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/a": { get: { "x-unstable": "yes" }, post: {} },
        "/b": { "x-stability": "beta", get: {}, delete: {} },
      },
    }),
  );
  assert.deepEqual([...unstableOperations(file)].sort(), ["DELETE /b", "GET /a", "GET /b"]);
});

test("unstableOperations returns nothing for an unreadable file", () => {
  assert.equal(unstableOperations(join(tmpdir(), "does-not-exist.json")).size, 0);
});

test("pathGroups keeps a version segment with the resource after it", () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-"));
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  writeFileSync(a, JSON.stringify({ openapi: "3.0.0", paths: { "/v1/customers": {}, "/v1/customers/{id}": {}, "/v2/charges": {} } }));
  writeFileSync(b, JSON.stringify({ openapi: "3.0.0", paths: { "/users/{id}": {}, "/v1/customers": {} } }));
  assert.deepEqual(pathGroups(a, b), ["/users", "/v1/customers", "/v2/charges"]);
});

test("inspectSpec counts operations and rejects Swagger 2.0", () => {
  assert.deepEqual(inspectSpec(fixture("base.json")), { valid: true, openapi: "3.0.3", operations: 5 });
  const dir = mkdtempSync(join(tmpdir(), "aw-"));
  const swagger = join(dir, "swagger.json");
  writeFileSync(swagger, JSON.stringify({ swagger: "2.0", paths: {} }));
  assert.equal(inspectSpec(swagger).valid, false);
  assert.match(inspectSpec(swagger).error!, /Swagger 2.0/);
});

test("diffSpecs groups, counts and flags breaking changes", { skip: !hasOasdiff && "oasdiff not installed" }, async () => {
  const d = await diffSpecs(fixture("base.json"), fixture("revision.json"));
  assert.equal(d.error, undefined);
  const hard = d.changes.filter((c) => c.level === "hard");

  // One schema change on two endpoints is one change, and every endpoint is kept.
  const email = hard.find((c) => c.text.includes("`email`"));
  assert.ok(email, "email removal is reported");
  assert.equal(email.operationCount, 2);
  assert.deepEqual([...email.allOperations!].sort(), ["GET /customers", "GET /customers/{id}"]);

  assert.ok(hard.some((c) => c.id === "api-path-removed-without-deprecation"), "removed endpoint is reported");
  assert.ok(hard.some((c) => c.operations.includes("POST /invoices")), "newly required request field is reported");

  // The preview endpoint's break is listed but not counted.
  const preview = hard.filter((c) => c.operations.includes("GET /previews"));
  assert.ok(preview.length > 0 && preview.every((c) => c.unstable));
  assert.equal(d.hard, hard.length - preview.length);
  assert.equal(d.hardUnstable, preview.length);
  assert.ok(!d.changes.some((c) => c.unstable && c.operations.some((o) => o !== "GET /previews")));
});

test("diffSpecs records an error instead of throwing on an unreadable spec", { skip: !hasOasdiff && "oasdiff not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  const d = await diffSpecs(fixture("base.json"), bad);
  assert.ok(d.error);
  assert.equal(d.hard, 0);
});
