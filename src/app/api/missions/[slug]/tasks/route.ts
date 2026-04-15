// src/app/api/missions/[slug]/tasks/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

// GET /api/missions/[slug]/tasks — task 一覧
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug } = await params;

  const ids = await redis.lrange(`mission:${slug}:tasks:index`, 0, -1);
  if (!ids || ids.length === 0) return Response.json({ tasks: [] });

  const keys = ids.map((id) => `mission:${slug}:tasks:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const tasks = raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));

  return Response.json({ tasks });
}

// POST /api/missions/[slug]/tasks — task 作成
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { slug } = await params;
  const { id, title, status, assignee, skills, priority, blocked_by } =
    await req.json();

  if (!id || !title) {
    return Response.json({ error: "id and title are required" }, { status: 400 });
  }

  const existing = await redis.get(`mission:${slug}:tasks:${id}`);
  const isNew = !existing;

  const task = {
    id,
    title,
    status: status ?? "pending",
    assignee: assignee ?? null,
    skills: skills ?? [],
    priority: priority ?? "medium",
    blocked_by: blocked_by ?? [],
    created_at: new Date().toISOString(),
  };

  await redis.set(`mission:${slug}:tasks:${id}`, JSON.stringify(task));
  if (isNew) {
    await redis.lpush(`mission:${slug}:tasks:index`, id);
  }

  return Response.json({ task }, { status: isNew ? 201 : 200 });
}
