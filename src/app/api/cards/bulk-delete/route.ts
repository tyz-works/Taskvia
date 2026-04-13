// src/app/api/cards/bulk-delete/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

const VALID_STATUSES = new Set(["pending", "approved", "denied"]);

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const body = await req.json();
  const { ids, status } = body as { ids?: string[]; status?: string };

  if (!ids && !status) {
    return Response.json({ error: "ids or status required" }, { status: 400 });
  }

  let targetIds: string[];

  if (ids) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return Response.json({ error: "ids must be an array of strings" }, { status: 400 });
    }
    targetIds = ids;
  } else {
    if (!VALID_STATUSES.has(status!)) {
      return Response.json({ error: "invalid status" }, { status: 400 });
    }
    const allIds = await redis.lrange<string>("approval:index", 0, -1);
    if (!allIds.length) return Response.json({ deleted: 0 });

    const keys = allIds.map((id) => `approval:${id}`);
    const raws = await redis.mget<(string | object | null)[]>(...keys);

    targetIds = allIds.filter((_, i) => {
      const raw = raws[i];
      if (!raw) return false;
      const card = typeof raw === "string" ? JSON.parse(raw) : raw;
      return (card as { status: string }).status === status;
    });
  }

  if (!targetIds.length) return Response.json({ deleted: 0 });

  const pipeline = redis.pipeline();
  for (const id of targetIds) {
    pipeline.del(`approval:${id}`);
    pipeline.lrem("approval:index", 1, id);
  }
  await pipeline.exec();

  return Response.json({ deleted: targetIds.length });
}
