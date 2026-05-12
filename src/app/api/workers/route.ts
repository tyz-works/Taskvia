// src/app/api/workers/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

// GET /api/workers — worker 一覧
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const names = await redis.smembers("worker:index");
  if (!names || names.length === 0) return Response.json({ workers: [] });

  const keys = names.map((n) => `worker:${n}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const workers = raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));

  const expired = names.filter((_, i) => raws[i] === null);
  if (expired.length > 0) {
    await redis.srem("worker:index", ...expired);
  }

  return Response.json({ workers });
}

// POST /api/workers — worker 登録 / 更新
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { name, role, skills, task_count, last_active } = await req.json();

  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const existing = await redis.get<string | object>(`worker:${name}`);
  const prev = existing
    ? typeof existing === "string"
      ? JSON.parse(existing)
      : existing
    : {};

  const worker = {
    ...prev,
    name,
    role: role ?? prev.role ?? undefined,
    skills: skills ?? prev.skills ?? [],
    task_count: task_count ?? prev.task_count ?? 0,
    last_active: last_active ?? prev.last_active ?? new Date().toISOString(),
  };

  await redis.set(`worker:${name}`, JSON.stringify(worker));
  await redis.sadd("worker:index", name);

  return Response.json({ worker }, { status: existing ? 200 : 201 });
}
