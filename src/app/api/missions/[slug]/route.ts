// src/app/api/missions/[slug]/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

// PATCH /api/missions/[slug] — mission 更新 (status)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug } = await params;
  const raw = await redis.get<string | object>(`mission:${slug}`);

  if (!raw) {
    return Response.json({ error: "Mission not found" }, { status: 404 });
  }

  const mission = typeof raw === "string" ? JSON.parse(raw) : raw;
  const body = await req.json();

  if (body.status !== undefined) mission.status = body.status;
  mission.updated_at = new Date().toISOString();

  await redis.set(`mission:${slug}`, JSON.stringify(mission));

  return Response.json({ mission });
}
