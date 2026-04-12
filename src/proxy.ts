import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// UI (/) と /api/cards を Basic Auth で保護する。
//
// 認証仕様:
//   - username: "admin" 固定
//   - password: 環境変数 TASKVIA_TOKEN
//   - TASKVIA_TOKEN 未設定時は無認証で通過 (オープンモード)

const USER = "admin";
const REALM = 'Basic realm="Taskvia", charset="UTF-8"';

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export default function proxy(request: NextRequest) {
  const token = process.env.TASKVIA_TOKEN;
  if (!token) return NextResponse.next(); // オープンモード

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }

  const colonAt = decoded.indexOf(":");
  if (colonAt < 0) return unauthorized();

  const user = decoded.slice(0, colonAt);
  const pass = decoded.slice(colonAt + 1);
  if (user !== USER || pass !== token) return unauthorized();

  return NextResponse.next(); // 認証OK
}

export const proxyConfig = {
  matcher: ["/", "/api/cards"],
};
