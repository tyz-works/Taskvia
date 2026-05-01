// src/app/api/request/route.ts
import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { publishApprovalRequest } from "@/lib/ntfy";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  let jsonBody: Record<string, unknown>;
  try {
    jsonBody = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const { tool, agent, task_title, task_id, priority, notify, project } = jsonBody;

  const id = nanoid();
  const card = {
    id,
    tool,
    agent,
    task_title: task_title ?? "Unknown task",
    task_id: task_id ?? null,
    priority: priority ?? "medium",
    status: "pending",
    project: project ?? "unknown",
    created_at: new Date().toISOString(),
  };

  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });
  await redis.lpush("approval:index", id);

  if (notify) {
    await publishApprovalRequest(id, card.agent ?? "Unknown", card.tool, `承認待ち: ${card.tool}`);
  }

  return Response.json({ id });
}
