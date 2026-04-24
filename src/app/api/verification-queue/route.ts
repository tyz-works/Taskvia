// src/app/api/verification-queue/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { searchParams } = new URL(req.url);
  const mission = searchParams.get("mission");

  if (!mission) {
    return Response.json({ error: "mission parameter required" }, { status: 400 });
  }

  const taskIds = await redis.lrange(`verification:index:${mission}`, 0, -1);
  if (taskIds.length === 0) return Response.json({ queue: [] });

  // Batch fetch all verification records via pipeline
  const pipeline = redis.pipeline();
  for (const id of taskIds) {
    pipeline.get(`verification:${id}`);
  }
  const raws = await pipeline.exec();

  const queue: unknown[] = [];
  const expired: string[] = [];

  for (let i = 0; i < taskIds.length; i++) {
    const raw = raws[i];
    if (raw === null) {
      expired.push(taskIds[i]);
      continue;
    }
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    queue.push({
      task_id: data.task_id,
      mission_slug: data.mission_slug ?? null,
      mode: data.mode ?? "standard",
      verdict: data.verdict,
      rework_count: data.rework_count ?? 0,
      verified_at: data.verified_at ?? null,
      verifier: data.verifier ?? null,
    });
  }

  // Lazy cleanup: remove expired task_ids from the index
  if (expired.length > 0) {
    const cleanupPipeline = redis.pipeline();
    for (const id of expired) {
      cleanupPipeline.lrem(`verification:index:${mission}`, 1, id);
    }
    await cleanupPipeline.exec();
  }

  return Response.json({ queue });
}
