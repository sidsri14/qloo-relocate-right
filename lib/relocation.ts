export type EntityRef = {
  id: string;
  name: string;
  type?: string;
};

export type CandidateRanking = {
  city: string;
  entityId: string;
  rank: number;
  affinity: number | null;
  reasons: string[];
};

export type RelocationRequest = {
  interests: string[];
  cities: string[];
};

export type RelocationResult = {
  source: "qloo" | "mock";
  resolvedInterests: EntityRef[];
  rankings: CandidateRanking[];
  trace: string[];
  caveat: string;
};

export interface TasteGraph {
  readonly source: "qloo" | "mock";
  resolveInterests(names: string[]): Promise<EntityRef[]>;
  resolveDestinations(names: string[]): Promise<EntityRef[]>;
  rankDestinations(
    interests: EntityRef[],
    destinations: EntityRef[],
  ): Promise<CandidateRanking[]>;
}

const MAX_INPUTS = 5;
const MAX_LENGTH = 80;

function cleanList(value: unknown, label: string, minimum: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const unique = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  if (unique.length < minimum || unique.length > MAX_INPUTS) {
    throw new Error(`${label} must contain ${minimum}-${MAX_INPUTS} unique values`);
  }
  if (unique.some((item) => item.length > MAX_LENGTH)) {
    throw new Error(`${label} values must be at most ${MAX_LENGTH} characters`);
  }

  return unique;
}

export function normalizeRequest(input: unknown): RelocationRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Request body must be an object");
  }

  const body = input as Record<string, unknown>;
  return {
    interests: cleanList(body.interests, "interests", 1),
    cities: cleanList(body.cities, "cities", 2),
  };
}

export async function runRelocationWorkflow(
  graph: TasteGraph,
  request: RelocationRequest,
): Promise<RelocationResult> {
  const trace: string[] = [];
  const interests = await graph.resolveInterests(request.interests);
  trace.push(`Resolved ${interests.length}/${request.interests.length} taste signals`);

  if (interests.length === 0) {
    throw new Error("None of the supplied interests could be resolved");
  }

  const destinations = await graph.resolveDestinations(request.cities);
  trace.push(`Resolved ${destinations.length}/${request.cities.length} candidate cities`);

  if (destinations.length < 2) {
    throw new Error("At least two candidate cities must resolve successfully");
  }

  const rankings = await graph.rankDestinations(interests, destinations);
  trace.push(`Ranked ${rankings.length} cities from one bounded taste-graph query`);

  if (rankings.length === 0) {
    throw new Error("Qloo returned no ranked candidate cities");
  }

  return {
    source: graph.source,
    resolvedInterests: interests,
    rankings,
    trace,
    caveat:
      graph.source === "mock"
        ? "Local mock mode: scores are deterministic fixtures, not Qloo evidence."
        : "Taste affinity is one decision signal; visas, cost, safety, and employment eligibility require separate verification.",
  };
}
