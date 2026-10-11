import { createRelocateRightHandler } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createRelocateRightHandler();

export async function GET(request: Request) {
  return handler.fetch(request);
}

export async function POST(request: Request) {
  return handler.fetch(request);
}

export async function DELETE(request: Request) {
  return handler.fetch(request);
}
