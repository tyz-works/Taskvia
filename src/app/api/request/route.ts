// src/app/api/request/route.ts
import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { publishApprovalRequest } from "@/lib/ntfy";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { tool, agent, task_title, task_id, priority } = await req.json();

  const id = nanoid();
  const card = {
    id,
    tool,
    agent,
    task_title: task_title ?? "Unknown task",
    task_id: task_id ?? null,
    priority: priority ?? "medium",
    status: "pending",
    created_at: new Date().toISOString(),
  };

  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });
  await redis.lpush("approval:index", id);

  await publishApprovalRequest(id, card.agent ?? "Unknown", card.tool, `承認待ち: ${card.tool}`);

  return Response.json({ id });
}
