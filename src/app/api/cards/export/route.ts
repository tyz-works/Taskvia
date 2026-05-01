// src/app/api/cards/export/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { badRequest } from "@/lib/responses";
import { parseRedisValues } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

const VALID_STATUSES = new Set(["pending", "approved", "denied"]);

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  if (status && !VALID_STATUSES.has(status)) {
    return badRequest("invalid status");
  }

  const allIds = await redis.lrange<string>("approval:index", 0, -1);
  if (!allIds.length) {
    return Response.json({ cards: [], count: 0, exported_at: new Date().toISOString() });
  }

  const keys = allIds.map((id) => `approval:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  let cards = parseRedisValues(raws);

  if (status) {
    cards = cards.filter((c) => (c as { status: string }).status === status);
  }

  return Response.json({
    cards,
    count: cards.length,
    exported_at: new Date().toISOString(),
  });
}
