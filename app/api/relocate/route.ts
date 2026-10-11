import { NextResponse } from "next/server";

import { MockTasteGraph, QlooTasteGraph } from "@/lib/qloo";
import { normalizeRequest, runRelocationWorkflow } from "@/lib/relocation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = normalizeRequest(await request.json());
    const useMock = process.env.QLOO_USE_MOCK === "true";
    const apiKey = process.env.QLOO_API_KEY?.trim();

    if (!useMock && !apiKey) {
      return NextResponse.json(
        { error: "Qloo access is not configured yet." },
        { status: 503 },
      );
    }

    const graph = useMock ? new MockTasteGraph() : new QlooTasteGraph(apiKey!);
    const result = await runRelocationWorkflow(graph, input);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = /must|at least|could be resolved/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
