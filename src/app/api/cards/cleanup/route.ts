// src/app/api/cards/cleanup/route.ts
// Removes orphan IDs from approval:index (entries whose approval:{id} key has expired)
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const allIds = await redis.lrange<string>("approval:index", 0, -1);
  if (!allIds.length) return Response.json({ cleaned: 0 });

  const keys = allIds.map((id) => `approval:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const orphanIds = allIds.filter((_, i) => raws[i] === null);
  if (!orphanIds.length) return Response.json({ cleaned: 0 });

  await Promise.all(
    orphanIds.map((id) => redis.lrem("approval:index", 1, id))
  );

  return Response.json({ cleaned: orphanIds.length });
}
