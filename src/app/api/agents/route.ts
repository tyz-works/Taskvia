// src/app/api/agents/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";

const redis = Redis.fromEnv();

const AGENT_TTL = 120; // seconds

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { name, role, skills, current_task_id, current_task_title, last_seen } =
    await req.json();

  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  const entry = {
    name,
    role: role ?? null,
    skills: skills ?? [],
    current_task_id: current_task_id ?? null,
    current_task_title: current_task_title ?? null,
    last_seen: last_seen ?? new Date().toISOString(),
  };

  await redis.set(`agent:${name}`, JSON.stringify(entry), { ex: AGENT_TTL });
  await redis.sadd("agent:index", name);

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { name } = await req.json();
  if (!name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  await redis.del(`agent:${name}`);
  await redis.srem("agent:index", name);

  return Response.json({ ok: true, deleted: name });
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const names = await redis.smembers("agent:index");
  if (!names || names.length === 0) return Response.json({ agents: [] });

  const keys = names.map((n) => `agent:${n}`);
  const raws = await redis.mget<(string | null)[]>(...keys);

  const agents = raws
    .filter((raw): raw is string => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));

  // TTL 切れで消えたエージェントを index から削除
  const expired = names.filter((_, i) => raws[i] === null);
  if (expired.length > 0) {
    await redis.srem("agent:index", ...expired);
  }

  return Response.json({ agents });
}
