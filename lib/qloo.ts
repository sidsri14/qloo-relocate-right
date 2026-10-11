import type { CandidateRanking, EntityRef, TasteGraph } from "./relocation";

const DEFAULT_BASE_URL = "https://hackathon.api.qloo.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nested(record: UnknownRecord, ...path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function collectEntityArrays(value: unknown, depth = 0): UnknownRecord[][] {
  if (depth > 4 || !value) return [];
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    const own = records.some(
      (item) => asString(item.entity_id) || asString(item.id) || asString(item.entityId),
    )
      ? [records]
      : [];
    return own.concat(value.flatMap((item) => collectEntityArrays(item, depth + 1)));
  }
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((item) => collectEntityArrays(item, depth + 1));
}

function entityRecords(payload: unknown): UnknownRecord[] {
  if (isRecord(payload)) {
    const preferred = [
      nested(payload, "results", "entities"),
      payload.results,
      payload.entities,
      nested(payload, "data", "results", "entities"),
      nested(payload, "data", "results"),
      nested(payload, "data", "entities"),
    ];

    for (const candidate of preferred) {
      if (!Array.isArray(candidate)) continue;
      const records = candidate.filter(isRecord);
      if (
        records.some(
          (item) => asString(item.entity_id) || asString(item.entityId) || asString(item.id),
        )
      ) {
        return records;
      }
    }
  }

  return collectEntityArrays(payload)
    .filter((records) => records.length > 0)
    .sort((left, right) => right.length - left.length)[0] ?? [];
}

export function extractEntities(payload: unknown): EntityRef[] {
  const candidates = entityRecords(payload)
    .map((item): EntityRef | null => {
      const id =
        asString(item.entity_id) ?? asString(item.entityId) ?? asString(item.id);
      const name =
        asString(item.name) ??
        asString(nested(item, "properties", "name")) ??
        asString(nested(item, "properties", "title"));
      const type =
        asString(item.type) ??
        (Array.isArray(item.types) ? item.types.map(asString).find(Boolean) : undefined) ??
        asString(item.subtype);
      return id && name ? { id, name, ...(type ? { type } : {}) } : null;
    })
    .filter((entity): entity is EntityRef => entity !== null);

  return [...new Map(candidates.map((entity) => [entity.id, entity])).values()];
}

export function buildInsightsUrl(
  baseUrl: string,
  interestIds: string[],
  destinationIds: string[],
): string {
  const url = new URL("/v2/insights", baseUrl);
  url.searchParams.set("filter.type", "urn:entity:destination");
  url.searchParams.set("filter.results.entities", destinationIds.join(","));
  url.searchParams.set("signal.interests.entities", interestIds.join(","));
  url.searchParams.set("feature.explainability", "true");
  url.searchParams.set("take", String(destinationIds.length));
  return url.toString();
}

function resultRecords(payload: unknown): UnknownRecord[] {
  return entityRecords(payload);
}

function affinityOf(record: UnknownRecord): number | null {
  return (
    asNumber(nested(record, "query", "affinity")) ??
    asNumber(record.affinity) ??
    asNumber(nested(record, "properties", "affinity"))
  );
}

function explainabilityReasons(
  record: UnknownRecord,
  interestById: Map<string, string>,
): string[] {
  const explainability = nested(record, "query", "explainability");
  if (!isRecord(explainability)) return [];

  return Object.entries(explainability)
    .filter(([, value]) => asNumber(value) !== null)
    .sort(([, left], [, right]) => (asNumber(right) ?? 0) - (asNumber(left) ?? 0))
    .slice(0, 3)
    .map(([key]) => {
      const interest = interestById.get(key);
      return interest ? `Aligned with ${interest}` : `Qloo signal: ${key}`;
    });
}

export class QlooTasteGraph implements TasteGraph {
  readonly source = "qloo" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("QLOO_API_KEY is required");
  }

  private async get(path: string, params: URLSearchParams): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    url.search = params.toString();
    const response = await this.fetcher(url, {
      headers: { "X-Api-Key": this.apiKey },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      throw new Error(`Qloo request failed (${response.status}): ${detail}`);
    }
    return response.json();
  }

  private async search(name: string, type?: string): Promise<EntityRef | null> {
    const params = new URLSearchParams({ query: name });
    if (type) params.append("types", type);
    const entities = extractEntities(await this.get("/search", params));
    return entities[0] ?? null;
  }

  async resolveInterests(names: string[]): Promise<EntityRef[]> {
    const results = await Promise.all(names.map((name) => this.search(name)));
    return results.filter((entity): entity is EntityRef => entity !== null);
  }

  async resolveDestinations(names: string[]): Promise<EntityRef[]> {
    const results = await Promise.all(
      names.map(async (name) => {
        const match = await this.search(name, "urn:entity:destination");
        return match ? { ...match, name } : null;
      }),
    );
    return results.filter((entity): entity is EntityRef => entity !== null);
  }

  async rankDestinations(
    interests: EntityRef[],
    destinations: EntityRef[],
  ): Promise<CandidateRanking[]> {
    const url = new URL(
      buildInsightsUrl(
        this.baseUrl,
        interests.map((item) => item.id),
        destinations.map((item) => item.id),
      ),
    );
    const payload = await this.get(url.pathname, url.searchParams);
    const records = resultRecords(payload);
    const destinationById = new Map(destinations.map((item) => [item.id, item]));
    const interestById = new Map(interests.map((item) => [item.id, item.name]));

    return records
      .map((record, index) => {
        const id =
          asString(record.entity_id) ??
          asString(record.entityId) ??
          asString(record.id);
        if (!id || !destinationById.has(id)) return null;
        const destination = destinationById.get(id)!;
        return {
          city: destination.name,
          entityId: id,
          rank: index + 1,
          affinity: affinityOf(record),
          reasons: explainabilityReasons(record, interestById),
        };
      })
      .filter((item): item is CandidateRanking => item !== null);
  }
}

function stableFraction(input: string): number {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

export class MockTasteGraph implements TasteGraph {
  readonly source = "mock" as const;

  async resolveInterests(names: string[]): Promise<EntityRef[]> {
    return names.map((name) => ({ id: `mock:interest:${name.toLowerCase()}`, name }));
  }

  async resolveDestinations(names: string[]): Promise<EntityRef[]> {
    return names.map((name) => ({ id: `mock:destination:${name.toLowerCase()}`, name }));
  }

  async rankDestinations(
    interests: EntityRef[],
    destinations: EntityRef[],
  ): Promise<CandidateRanking[]> {
    const signal = interests.map((item) => item.name.toLowerCase()).sort().join("|");
    return destinations
      .map((destination) => ({
        city: destination.name,
        entityId: destination.id,
        affinity: Number((0.55 + stableFraction(`${signal}|${destination.name}`) * 0.39).toFixed(4)),
        rank: 0,
        reasons: interests.slice(0, 3).map((item) => `Fixture signal: ${item.name}`),
      }))
      .sort((left, right) => (right.affinity ?? 0) - (left.affinity ?? 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }
}
