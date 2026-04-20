import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";

const redis = Redis.fromEnv();

const TOKEN_TTL = parseInt(process.env.APPROVAL_TOKEN_TTL_SECONDS ?? "900", 10);

export async function publishApprovalRequest(
  requestId: string,
  agent: string,
  tool: string,
  summary: string,
): Promise<void> {
  const ntfyUrl = (process.env.NTFY_URL ?? "").replace(/\/$/, "");
  const topic = process.env.NTFY_TOPIC;
  const user = process.env.NTFY_USER;
  const pass = process.env.NTFY_PASS;

  if (!ntfyUrl || !topic) return;

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + TOKEN_TTL * 1000).toISOString();

  await redis.set(
    `approval_token:${token}`,
    JSON.stringify({
      request_id: requestId,
      decision: null,
      expires_at: expiresAt,
      consumed_at: null,
    }),
    { ex: TOKEN_TTL },
  );

  const baseUrl = (process.env.TASKVIA_BASE_URL ?? "https://taskvia.vercel.app").replace(/\/$/, "");
  const approveUrl = `shortcuts://run-shortcut?name=Taskvia%20Approve&input=text&text=${encodeURIComponent(token)}`;
  const denyUrl = `shortcuts://run-shortcut?name=Taskvia%20Deny&input=text&text=${encodeURIComponent(token)}`;

  const headers: Record<string, string> = {
    Title: `[${agent}] ${tool} 承認要求`,
    Priority: "high",
    Tags: "lock",
    Click: `${baseUrl}/requests/${requestId}`,
    Actions: `view, ✓承認, ${approveUrl}, clear=true; view, ✗却下, ${denyUrl}, clear=true`,
  };

  if (user && pass) {
    headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  await fetch(`${ntfyUrl}/${topic}`, {
    method: "POST",
    body: summary,
    headers,
  }).catch(() => {});
}
