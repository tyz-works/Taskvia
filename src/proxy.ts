import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// UI (/) と /api/cards をセッション Cookie で保護する。
//
// 認証仕様:
//   - /login にパスワード入力フォームがあり、Server Action が Cookie をセット
//   - Cookie 名: taskvia-session、値: SHA-256(TASKVIA_TOKEN)
//   - TASKVIA_TOKEN 未設定時は無認証で通過 (オープンモード)

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function proxy(request: NextRequest) {
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();
  if (!token) return NextResponse.next(); // オープンモード

  const session = request.cookies.get("taskvia-session")?.value;
  if (session) {
    const expected = await hashToken(token);
    if (session === expected) return NextResponse.next(); // 認証OK
  }

  // 未認証: API は 401、UI は /login へリダイレクト
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return new Response("Unauthorized", { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/", "/api/cards"],
};
