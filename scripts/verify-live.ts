import { QlooTasteGraph } from "../lib/qloo";
import { runRelocationWorkflow } from "../lib/relocation";

const apiKey = process.env.QLOO_API_KEY?.trim();

if (!apiKey) {
  console.error("QLOO_API_KEY is required for live verification.");
  process.exit(1);
}

async function main(key: string): Promise<void> {
  const result = await runRelocationWorkflow(new QlooTasteGraph(key), {
    interests: ["coffee", "live music"],
    cities: ["Berlin", "Lisbon", "Tokyo"],
  });

  if (result.source !== "qloo") {
    throw new Error("Live verification unexpectedly used a non-Qloo source.");
  }
  if (result.resolvedInterests.length < 1) {
    throw new Error("Qloo did not resolve any interest signals.");
  }
  if (result.rankings.length !== 3) {
    throw new Error(`Expected three ranked destinations, received ${result.rankings.length}.`);
  }

  console.log(
    JSON.stringify(
      {
        source: result.source,
        resolvedInterestCount: result.resolvedInterests.length,
        rankingCount: result.rankings.length,
        rankedCities: result.rankings.map((ranking) => ranking.city),
        trace: result.trace,
      },
      null,
      2,
    ),
  );
}

main(apiKey).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
