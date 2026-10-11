import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInsightsUrl,
  extractEntities,
  MockTasteGraph,
  QlooTasteGraph,
} from "../lib/qloo";
import { normalizeRequest, runRelocationWorkflow } from "../lib/relocation";

test("normalizes, trims, and deduplicates request values", () => {
  assert.deepEqual(
    normalizeRequest({
      interests: [" jazz ", "coffee", "jazz"],
      cities: ["Berlin", " Lisbon ", "Berlin"],
    }),
    { interests: ["jazz", "coffee"], cities: ["Berlin", "Lisbon"] },
  );
});

test("rejects a comparison with fewer than two cities", () => {
  assert.throws(
    () => normalizeRequest({ interests: ["jazz"], cities: ["Berlin"] }),
    /cities must contain 2-5/,
  );
});

test("builds one bounded destination insights request", () => {
  const url = new URL(
    buildInsightsUrl(
      "https://hackathon.api.qloo.com",
      ["interest-1", "interest-2"],
      ["city-1", "city-2"],
    ),
  );
  assert.equal(url.pathname, "/v2/insights");
  assert.equal(url.searchParams.get("filter.type"), "urn:entity:destination");
  assert.equal(url.searchParams.get("filter.results.entities"), "city-1,city-2");
  assert.equal(url.searchParams.get("signal.interests.entities"), "interest-1,interest-2");
  assert.equal(url.searchParams.get("take"), "2");
});

test("extracts and deduplicates entities from nested API payloads", () => {
  const entities = extractEntities({
    results: {
      entities: [
        { entity_id: "a", name: "Alpha", type: "urn:entity:artist" },
        { entity_id: "a", name: "Alpha" },
        { id: "b", properties: { name: "Beta" } },
      ],
    },
  });
  assert.deepEqual(
    entities.map(({ id, name }) => ({ id, name })),
    [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ],
  );
});

test("mock workflow is deterministic, ranked, and explicitly labeled", async () => {
  const graph = new MockTasteGraph();
  const request = normalizeRequest({
    interests: ["jazz", "coffee"],
    cities: ["Berlin", "Lisbon", "Toronto"],
  });
  const first = await runRelocationWorkflow(graph, request);
  const second = await runRelocationWorkflow(graph, request);

  assert.deepEqual(first, second);
  assert.equal(first.source, "mock");
  assert.match(first.caveat, /not Qloo evidence/);
  assert.deepEqual(first.rankings.map((item) => item.rank), [1, 2, 3]);
  assert.ok(
    first.rankings.every(
      (item, index, rankings) => index === 0 || (rankings[index - 1].affinity ?? 0) >= (item.affinity ?? 0),
    ),
  );
});

test("Qloo adapter parses current search and insights response shapes", async () => {
  const requests: Array<{ url: string; apiKey: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ url: url.toString(), apiKey: headers.get("X-Api-Key") });

    if (url.pathname === "/search") {
      const query = url.searchParams.get("query");
      const type = url.searchParams.get("types");
      if (type === "urn:entity:destination") {
        return Response.json({
          results: [
            {
              entity_id: `destination-${query?.toLowerCase()}`,
              name: query,
              types: ["urn:entity:destination"],
            },
          ],
        });
      }
      return Response.json({
        results: [
          {
            entity_id: "interest-jazz",
            name: "Jazz",
            types: ["urn:entity:artist"],
          },
        ],
      });
    }

    if (url.pathname === "/v2/insights") {
      return Response.json({
        success: true,
        results: {
          entities: [
            {
              entity_id: "destination-lisbon",
              name: "Lisbon",
              query: {
                affinity: 0.91,
                explainability: { "interest-jazz": 0.82 },
              },
            },
            {
              entity_id: "destination-berlin",
              name: "Berlin",
              query: { affinity: 0.73 },
            },
          ],
        },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const graph = new QlooTasteGraph(
    "server-only-test-key",
    "https://hackathon.api.qloo.com",
    fetcher,
  );
  const result = await runRelocationWorkflow(
    graph,
    normalizeRequest({ interests: ["Jazz"], cities: ["Berlin", "Lisbon"] }),
  );

  assert.equal(result.source, "qloo");
  assert.deepEqual(result.rankings.map((item) => item.city), ["Lisbon", "Berlin"]);
  assert.equal(result.rankings[0].affinity, 0.91);
  assert.deepEqual(result.rankings[0].reasons, ["Aligned with Jazz"]);
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.apiKey === "server-only-test-key"));
  assert.ok(requests.every((request) => !request.url.includes("server-only-test-key")));
});

test("workflow rejects an empty ranking instead of presenting a false result", async () => {
  const graph = {
    source: "qloo" as const,
    async resolveInterests() {
      return [{ id: "interest-1", name: "Jazz" }];
    },
    async resolveDestinations() {
      return [
        { id: "city-1", name: "Berlin" },
        { id: "city-2", name: "Lisbon" },
      ];
    },
    async rankDestinations() {
      return [];
    },
  };

  await assert.rejects(
    runRelocationWorkflow(
      graph,
      normalizeRequest({ interests: ["Jazz"], cities: ["Berlin", "Lisbon"] }),
    ),
    /no ranked candidate cities/,
  );
});
