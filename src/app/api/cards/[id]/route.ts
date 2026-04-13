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

  // Always remove from index to clean up orphan entries
  await redis.lrem("approval:index", 1, id);

  if (!raw) {
    // Orphan entry cleaned from index, but no actual card existed
    return Response.json({ ok: true, deleted: 0 });
  }

  await redis.del(`approval:${id}`);
  return Response.json({ ok: true, deleted: 1 });
}
