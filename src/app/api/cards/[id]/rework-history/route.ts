// src/app/api/cards/[id]/rework-history/route.ts
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { parseRedisValue } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raws = await redis.lrange(`verification:history:${id}`, 0, -1);

  const cycles = raws
    .map((raw) => {
      type RH = { rework_count?: number; verdict: string; checks?: { name: string; status: string; duration_s?: number }[]; verified_at?: string | null };
      const data = parseRedisValue<RH>(raw)!;
      return {
        cycle: data.rework_count ?? 0,
        verdict: data.verdict,
        failed_checks: (data.checks ?? []).filter((c) => c.status === "fail"),
        verified_at: data.verified_at ?? null,
      };
    })
    .sort((a, b) => a.cycle - b.cycle);

  return Response.json({ cycles });
}
