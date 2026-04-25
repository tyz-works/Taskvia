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
  const approveUrl = `${baseUrl}/api/approve-token/${token}`;
  const denyUrl = `${baseUrl}/api/deny-token/${token}`;

  const payload = {
    topic,
    title: `[${agent}] ${tool} 承認要求`,
    message: summary,
    priority: 4,
    tags: ["lock"],
    click: `${baseUrl}/requests/${requestId}`,
    actions: [
      { action: "http", label: "✓承認", url: approveUrl, method: "POST", clear: true },
      { action: "http", label: "✗却下", url: denyUrl, method: "POST", clear: true },
    ],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (user && pass) {
    headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  const res = await fetch(ntfyUrl, {
    method: "POST",
    body: JSON.stringify(payload),
    headers,
  }).catch((e) => {
    console.error("[ntfy] publish failed:", e);
    return null;
  });

  if (res && !res.ok) {
    console.error(`[ntfy] publish error: ${res.status} ${res.statusText}`, await res.text().catch(() => ""));
  }
}
