"use server";

import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";
import type { MissionRequest } from "./api/requests/route";

const redis = Redis.fromEnv();

export async function submitRequest(data: {
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  skills: string[];
  target_dir: string;
  deadline_note: string;
}): Promise<{ id: string } | { error: string }> {
  const { title, body, priority, skills, target_dir, deadline_note } = data;

  if (!title || title.trim() === "") return { error: "title is required" };
  if (!body || body.trim() === "") return { error: "body is required" };

  const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
  const resolvedPriority = VALID_PRIORITIES.has(priority) ? priority : "medium";

  if (target_dir && !target_dir.startsWith("/")) {
    return { error: "target_dir must be an absolute path" };
  }

  const id = nanoid();
  const entry: MissionRequest = {
    id,
    title: title.trim(),
    body: body.trim(),
    priority: resolvedPriority as MissionRequest["priority"],
    skills: skills.filter((s) => typeof s === "string"),
    target_dir: target_dir.trim(),
    deadline_note: deadline_note.trim(),
    mission_slug: null,
    status: "pending",
    created_at: new Date().toISOString(),
    processed_at: null,
  };

  await redis.set(`mission_request:${id}`, JSON.stringify(entry));
  await redis.lpush("mission_requests:index", id);

  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      body: `新規依頼: ${entry.title}`,
      headers: {
        Title: "New Mission Request",
        Priority: resolvedPriority === "high" ? "high" : "default",
        Click: "https://taskvia.vercel.app",
        Tags: "memo",
      },
    }).catch(() => {});
  }

  return { id };
}

export async function fetchRequests(status?: string): Promise<MissionRequest[]> {
  const VALID_STATUSES = new Set(["pending", "processing", "done", "rejected"]);
  if (status && !VALID_STATUSES.has(status)) return [];

  const ids = await redis.lrange<string>("mission_requests:index", 0, 49);
  if (!ids.length) return [];

  const keys = ids.map((id) => `mission_request:${id}`);
  const raws = await redis.mget<string[]>(...keys);

  let requests: MissionRequest[] = raws
    .filter((r): r is string => r !== null)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r));

  if (status) {
    requests = requests.filter((r) => r.status === status);
  }

  return requests;
}

export async function approveCard(id: string): Promise<{ ok: boolean } | { error: string }> {
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return { error: "not_found" };

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  card.status = "approved";
  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });

  return { ok: true };
}

export async function denyCard(id: string): Promise<{ ok: boolean } | { error: string }> {
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return { error: "not_found" };

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  card.status = "denied";
  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });

  return { ok: true };
}
