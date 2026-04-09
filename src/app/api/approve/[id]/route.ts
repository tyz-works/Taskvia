// src/app/api/approve/[id]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return Response.json({ error: "not_found" }, { status: 404 });

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  card.status = "approved";
  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });

  return Response.json({ ok: true });
}
