// src/app/api/missions/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { badRequest } from "@/lib/responses";
import { parseRedisValues } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

// GET /api/missions — mission 一覧
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const slugs = await redis.lrange("mission:index", 0, -1);
  if (!slugs || slugs.length === 0) return Response.json({ missions: [] });

  const keys = slugs.map((s) => `mission:${s}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const missions = parseRedisValues(raws);

  return Response.json({ missions });
}

// POST /api/missions — mission 作成
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug, title, status } = await req.json();

  if (!slug || !title) {
    return badRequest("slug and title are required");
  }

  // 既存エントリの有無を確認し、新規のときのみ lpush を実行（冪等化）
  // NOTE: 同時接続による race condition は許容（実運用上のリスクが低いため）
  const existing = await redis.get(`mission:${slug}`);
  const isNew = !existing;

  const mission = {
    slug,
    title,
    status: status ?? "in_progress",
    created_at: new Date().toISOString(),
  };

  await redis.set(`mission:${slug}`, JSON.stringify(mission));
  if (isNew) {
    await redis.lpush("mission:index", slug);
  }

  return Response.json({ mission }, { status: isNew ? 201 : 200 });
}
