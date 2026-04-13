// src/app/api/cards/[id]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return Response.json({ error: "not_found" }, { status: 404 });

  await redis.del(`approval:${id}`);
  await redis.lrem("approval:index", 1, id);

  return Response.json({ ok: true });
}
