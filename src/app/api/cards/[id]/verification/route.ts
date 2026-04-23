// src/app/api/cards/[id]/verification/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`verification:${id}`);

  if (raw === null) {
    return Response.json({ verification: null });
  }

  const verification = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Response.json({ verification });
}
