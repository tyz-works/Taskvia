// src/app/api/cards/[id]/verification/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { parseRedisValue } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get<string | object>(`verification:${id}`);

  if (raw === null) {
    return Response.json({ verification: null });
  }

  const verification = parseRedisValue(raw);
  return Response.json({ verification });
}
