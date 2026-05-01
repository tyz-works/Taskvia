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

  let jsonBody: Record<string, unknown>;
  try {
    jsonBody = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const { slug, title, status } = jsonBody;

  if (!slug || !title) {
    return Response.json({ error: "slug and title are required" }, { status: 400 });
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
