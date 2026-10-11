import assert from "node:assert/strict";
import test from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createRelocateRightHandler } from "../lib/mcp";
import { MockTasteGraph } from "../lib/qloo";

function parseToolResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") throw new Error("Tool did not return text content");
  return JSON.parse(text.text);
}

test("exposes the bounded relocation workflow through Streamable HTTP MCP", async () => {
  const handler = createRelocateRightHandler(() => new MockTasteGraph());
  const client = new Client({ name: "relocate-right-test", version: "1.0.0" });

  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );

  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      "rank_relocation_shortlist",
    ]);

    const result = await client.callTool({
      name: "rank_relocation_shortlist",
      arguments: {
        interests: ["jazz", "independent coffee"],
        cities: ["Berlin", "Lisbon", "Toronto"],
      },
    });
    const parsed = parseToolResult(result);
    assert.equal(parsed.source, "mock");
    assert.equal(parsed.rankings.length, 3);
    assert.match(parsed.caveat, /not Qloo evidence/);
  } finally {
    await client.close();
    await handler.close();
  }
});
