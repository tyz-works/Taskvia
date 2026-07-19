import { Redis } from "@upstash/redis";
import { after } from "next/server";
import { publishResultNotification, publishErrorNotification } from "@/lib/ntfy";

const redis = Redis.fromEnv();

const CONSUMED_TOKEN_TTL_SECONDS = 60;

// GET → check(consumed_at) → SET の非原子3手順を単一 Lua スクリプトで原子化する
// (BUG-2)。src/app/api/cards/route.ts の scriptLoad+evalsha パターンと違い、
// token 消費はポーリングされないため毎回 EVAL で十分(SHA キャッシュ不要)。
const CONSUME_TOKEN_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw == false then
  return {'missing'}
end
local entry = cjson.decode(raw)
if entry.consumed_at ~= nil and entry.consumed_at ~= cjson.null then
  return {'already_used'}
end
entry.decision = ARGV[1]
entry.consumed_at = ARGV[2]
local updated = cjson.encode(entry)
redis.call('SET', KEYS[1], updated, 'EX', tonumber(ARGV[3]))
return {'ok', updated}
`;

type ConsumeResult = ["missing"] | ["already_used"] | ["ok", string];

export async function handleTokenDecision(
  token: string,
  decision: "approved" | "denied",
): Promise<Response> {
  const consumedAt = new Date().toISOString();
  const [outcome, updatedRaw] = await redis.eval<string[], ConsumeResult>(
    CONSUME_TOKEN_SCRIPT,
    [`approval_token:${token}`],
    [decision, consumedAt, String(CONSUMED_TOKEN_TTL_SECONDS)],
  );

  if (outcome === "missing") {
    after(() => publishErrorNotification("expired"));
    return Response.json({ error: "invalid_or_expired_token" }, { status: 404 });
  }

  if (outcome === "already_used") {
    after(() => publishErrorNotification("already_used"));
    return Response.json({ error: "token_already_used" }, { status: 409 });
  }

  const entry = JSON.parse(updatedRaw as string) as Record<string, unknown>;

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
