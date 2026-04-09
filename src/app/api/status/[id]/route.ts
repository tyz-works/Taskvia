// src/app/api/status/[id]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return Response.json({ status: "not_found" }, { status: 404 });

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Response.json({ status: card.status, card });
}
