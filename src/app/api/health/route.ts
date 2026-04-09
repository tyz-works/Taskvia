import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function GET() {
  await redis.set("health", "ok");
  const val = await redis.get("health");
  return Response.json({ status: val });
}
