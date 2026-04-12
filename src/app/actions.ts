"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MissionRequest } from "./api/requests/route";

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function loginAction(formData: FormData) {
  const password = ((formData.get("password") as string) ?? "").trim();
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();

  if (!token || !password || password !== token) {
    redirect("/login?error=1");
  }

  const hash = await hashToken(token);
  const cookieStore = await cookies();
  cookieStore.set("taskvia-session", hash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  redirect("/");
}

function authHeaders(): Record<string, string> {
  const token = process.env.TASKVIA_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function submitRequest(data: {
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  skills: string[];
  target_dir: string;
  deadline_note: string;
}): Promise<{ id: string } | { error: string }> {
  const res = await fetch(`${BASE_URL}/api/requests`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });

  const json = await res.json();
  if (!res.ok) return { error: json.error ?? `Error: ${res.status}` };
  return { id: json.id };
}

export async function fetchRequests(status?: string): Promise<MissionRequest[]> {
  const url = new URL(`${BASE_URL}/api/requests`);
  if (status) url.searchParams.set("status", status);

  const res = await fetch(url.toString(), {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.requests ?? [];
}

export async function approveCard(id: string): Promise<{ ok: boolean } | { error: string }> {
  const res = await fetch(`${BASE_URL}/api/approve/${id}`, {
    method: "POST",
    headers: authHeaders(),
  });

  const json = await res.json();
  if (!res.ok) return { error: json.error ?? `Error: ${res.status}` };
  return { ok: true };
}

export async function denyCard(id: string): Promise<{ ok: boolean } | { error: string }> {
  const res = await fetch(`${BASE_URL}/api/deny/${id}`, {
    method: "POST",
    headers: authHeaders(),
  });

  const json = await res.json();
  if (!res.ok) return { error: json.error ?? `Error: ${res.status}` };
  return { ok: true };
}
