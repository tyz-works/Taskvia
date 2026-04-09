// src/app/api/cards/route.ts
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function GET() {
  const ids = await redis.lrange("approval:index", 0, 99);
  if (!ids.length) return Response.json({ cards: [] });

  const raws = await redis.mget<string[]>(...ids.map((id) => `approval:${id}`));
  const cards = raws
    .filter(Boolean)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));

  return Response.json({ cards });
}
