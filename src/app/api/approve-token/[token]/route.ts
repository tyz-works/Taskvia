// src/app/api/approve-token/[token]/route.ts
// Bearer 認証不要 — token 自体が秘密
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const raw = await redis.get(`approval_token:${token}`);
  if (!raw) return Response.json({ error: "invalid_or_expired_token" }, { status: 404 });

  const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (entry.consumed_at) return Response.json({ error: "token_already_used" }, { status: 409 });

  entry.decision = "approved";
  entry.consumed_at = new Date().toISOString();
  await redis.set(`approval_token:${token}`, JSON.stringify(entry), { ex: 60 });

  const cardRaw = await redis.get(`approval:${entry.request_id}`);
  if (cardRaw) {
    const card = typeof cardRaw === "string" ? JSON.parse(cardRaw) : cardRaw;
    card.status = "approved";
    await redis.set(`approval:${entry.request_id}`, JSON.stringify(card), { ex: 600 });
  }

  return Response.json({ ok: true });
}
