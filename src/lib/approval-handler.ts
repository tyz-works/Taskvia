import { Redis } from "@upstash/redis";
import { after } from "next/server";
import { publishResultNotification, publishErrorNotification } from "@/lib/ntfy";

const redis = Redis.fromEnv();

export async function handleTokenDecision(
  token: string,
  decision: "approved" | "denied",
): Promise<Response> {
  const raw = await redis.get(`approval_token:${token}`);
  if (!raw) {
    after(() => publishErrorNotification("expired"));
    return Response.json({ error: "invalid_or_expired_token" }, { status: 404 });
  }

  const entry = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
  if (entry.consumed_at) {
    after(() => publishErrorNotification("already_used"));
    return Response.json({ error: "token_already_used" }, { status: 409 });
  }

  entry.decision = decision;
  entry.consumed_at = new Date().toISOString();
  await redis.set(`approval_token:${token}`, JSON.stringify(entry), { ex: 60 });

  let tool = (entry.tool as string) ?? "unknown";
  let agent = (entry.agent as string) ?? "unknown";

  const cardRaw = await redis.get(`approval:${entry.request_id}`);
  if (cardRaw) {
    const card = typeof cardRaw === "string" ? JSON.parse(cardRaw) : (cardRaw as Record<string, unknown>);
    tool = (card.tool as string) ?? tool;
    agent = (card.agent as string) ?? agent;
    card.status = decision;
    await redis.set(`approval:${entry.request_id}`, JSON.stringify(card), { ex: 600 });
  }

  after(async () => {
    await Promise.all([
      publishResultNotification(decision, tool, agent),
      logApprovalOperation(decision, tool, agent, entry.request_id as string),
    ]);
  });

  return Response.json({ ok: true });
}

async function logApprovalOperation(
  decision: "approved" | "denied",
  tool: string,
  agent: string,
  requestId: string,
): Promise<void> {
  const logEntry = {
    type: "approval",
    content: `${decision === "approved" ? "承認" : "却下"}: ${tool} by ${agent}`,
    task_title: `Approval: ${tool}`,
    task_id: requestId,
    agent,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush("agent:logs", JSON.stringify(logEntry)).catch((e) => {
    console.error("[approval-handler] log failed:", e);
  });
}
