import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { MockTasteGraph, QlooTasteGraph } from "./qloo";
import {
  normalizeRequest,
  runRelocationWorkflow,
  type RelocationResult,
  type TasteGraph,
} from "./relocation";

type GraphFactory = () => TasteGraph;

function configuredGraph(): TasteGraph {
  if (process.env.QLOO_USE_MOCK === "true") return new MockTasteGraph();

  const apiKey = process.env.QLOO_API_KEY?.trim();
  if (!apiKey) throw new Error("Qloo access is not configured yet");
  return new QlooTasteGraph(apiKey);
}

function asToolResult(value: RelocationResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createRelocateRightServer(graphFactory: GraphFactory = configuredGraph) {
  const server = new McpServer({
    name: "relocate-right",
    version: "0.2.0",
  });

  server.registerTool(
    "rank_relocation_shortlist",
    {
      description:
        "Resolve 1-5 public cultural interests and rank 2-5 candidate destinations with Qloo. This tool does not assess visas, employment eligibility, safety, salary, or cost of living.",
      inputSchema: z.object({
        interests: z.array(z.string().min(1).max(80)).min(1).max(5),
        cities: z.array(z.string().min(1).max(80)).min(2).max(5),
      }),
    },
    async (input) => {
      const request = normalizeRequest(input);
      return asToolResult(await runRelocationWorkflow(graphFactory(), request));
    },
  );

  return server;
}

export function createRelocateRightHandler(graphFactory: GraphFactory = configuredGraph) {
  return createMcpHandler(() => createRelocateRightServer(graphFactory));
}
