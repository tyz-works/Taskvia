// src/app/api/missions/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

// GET /api/missions — mission 一覧
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const slugs = await redis.lrange("mission:index", 0, -1);
  if (!slugs || slugs.length === 0) return Response.json({ missions: [] });

  const keys = slugs.map((s) => `mission:${s}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const missions = raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));

  return Response.json({ missions });
}

// POST /api/missions — mission 作成
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug, title, status } = await req.json();

  if (!slug || !title) {
    return Response.json({ error: "slug and title are required" }, { status: 400 });
  }

  const mission = {
    slug,
    title,
    status: status ?? "in_progress",
    created_at: new Date().toISOString(),
  };

  await redis.set(`mission:${slug}`, JSON.stringify(mission));
  await redis.lpush("mission:index", slug);

  return Response.json({ mission }, { status: 201 });
}
