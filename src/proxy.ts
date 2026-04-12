import { auth } from "@/auth";
import { NextResponse } from "next/server";

// UI (/) と /api/cards を Google 認証で保護する。
// TASKVIA_TOKEN 未設定時は無認証で通過 (オープンモード)

export default auth((request) => {
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();
  if (!token) return NextResponse.next(); // オープンモード

  if (!request.auth) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/", "/api/cards"],
};
