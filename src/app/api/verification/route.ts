// src/app/api/verification/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { VerificationPayload } from "@/lib/verification";
import { VERIFICATION_TTL } from "@/lib/verification";

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  let body: VerificationPayload;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { task_id, mission_slug, mode, verdict, checks, rework_count, verified_at, verifier } = body;

  if (!task_id || !verdict || !checks) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const record = {
    task_id,
    mission_slug: mission_slug ?? null,
    mode: mode ?? "standard",
    verdict,
    checks,
    rework_count: rework_count ?? 0,
    verified_at: verified_at ?? new Date().toISOString(),
    verifier: verifier ?? null,
    received_at: new Date().toISOString(),
  };

  const recordJson = JSON.stringify(record);

  await Promise.all([
    redis.set(`verification:${task_id}`, recordJson, { ex: VERIFICATION_TTL }),
    ...(mission_slug
      ? [redis.rpush(`verification:index:${mission_slug}`, task_id)]
      : []),
    redis.rpush(`verification:history:${task_id}`, recordJson),
    redis.expire(`verification:history:${task_id}`, VERIFICATION_TTL),
  ]);

  return Response.json({ ok: true, task_id });
}
