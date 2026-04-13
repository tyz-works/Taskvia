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

export interface Mission {
  slug: string;
  title: string;
  status: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  assignee: string | null;
  skills: string[];
  priority: "high" | "medium" | "low";
  blocked_by: string[];
  created_at: string;
}

export async function fetchMissions(): Promise<Mission[]> {
  const slugs = await redis.lrange<string>("mission:index", 0, -1);
  if (!slugs || slugs.length === 0) return [];

  const keys = slugs.map((s) => `mission:${s}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  return raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as Mission[];
}

export async function fetchMissionTasks(slug: string): Promise<Task[]> {
  const ids = await redis.lrange<string>(`mission:${slug}:tasks:index`, 0, -1);
  if (!ids || ids.length === 0) return [];

  const keys = ids.map((id) => `mission:${slug}:tasks:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  return raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as Task[];
}

export interface ApprovalCard {
  id: string;
  tool: string;
  agent: string;
  task_title: string;
  task_id: string | null;
  priority: "high" | "medium" | "low";
  status: "pending" | "approved" | "denied";
  created_at: string;
}

export interface AgentStatus {
  name: string;
  role: string | null;
  skills: string[];
  current_task_id: string | null;
  current_task_title: string | null;
  last_seen: string;
}

export async function fetchAgents(): Promise<AgentStatus[]> {
  const names = await redis.smembers("agent:index");
  if (!names || names.length === 0) return [];

  const keys = names.map((n) => `agent:${n}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const agents = raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as AgentStatus[];

  // Remove expired entries from index
  const expired = names.filter((_, i) => raws[i] === null);
  if (expired.length > 0) {
    await redis.srem("agent:index", ...expired);
  }

  return agents;
}

export async function fetchApprovalCards(): Promise<ApprovalCard[]> {
  const ids = await redis.lrange<string>("approval:index", 0, 99);
  if (!ids || ids.length === 0) return [];

  const keys = ids.map((id) => `approval:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  return raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as ApprovalCard[];
}
