// matcher RED再現テスト: Admiral設計判断(docs/20260720_phase0_auth_gateway_decision.md §1
// 「必須テスト・matcher test」)が求める期待 matcher 契約を、現行 src/proxy.ts の
// `config.matcher = ["/", "/api/cards"]` に対して検証する。
//
// 期待契約:
//   - Proxy 非該当: /api/cards, /api/cards/export, /api/cards/{id}/verification
//   - Proxy 該当  : /, /missions/{slug}, /verification-queue
//   - Proxy 非該当: /login, /api/auth/**, /_next/**
//
// 現行 matcher は plain string の配列("/", "/api/cards")であり、Next.js の matcher
// 仕様上これは「厳密一致(exact match)」としてのみ機能する(:param や (.*) 等のワイルド
// カード構文を含まないため、サブパスへは一切拡張されない)。この厳密一致解釈を
// `matchesCurrentMatcher()` として素朴に実装し、現行 config に対して評価する。
//
// ★実装メモ: `import { config } from "@/proxy"` は proxy.ts → "@/auth" → "next-auth" の
// import chain を評価してしまい、next-auth 内部が `next/server`(拡張子なし)を
// import する箇所で vitest(vite)の ESM resolver が `Cannot find module` で失敗する
// (next の package.json に exports map がなく、Node の CJS 拡張子解決には乗るが
// vite の resolver はより厳密なため)。この既存の vitest 環境側の問題を回避するため、
// 本テストは src/proxy.ts を import(モジュール評価)せず、ソースファイルのテキストを
// 直接読み込んで `matcher: [...]` の literal を正規表現で抽出する形にした
// (実体は実ファイルから取得しており、手打ちのハードコードではない)。
// vitest.config.ts の resolver 設定変更は本タスクのスコープ外(auth境界とは無関係の
// 別問題)と判断し、行っていない。
//
// ★このヘルパーは「現行 matcher が plain string の配列である」という現在の実装形状に
// 対してのみ忠実(faithful)である。Geordi Phase2の GREEN 化で matcher が単一の
// negative-lookahead 正規表現文字列(Next.js コミュニティでよく使われる
// `/((?!api|_next/static|...).*)`型)等の別形状に変わった場合、このヘルパーは
// そのままでは機能しない。Phase2でこのテストファイルの matcher 解釈ロジックを
// 新形状に合わせて更新する必要がある(本ファイルはその前提を明記して引き継ぐ)。
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

let currentMatcher: string[] = [];

beforeAll(() => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/proxy.ts"),
    "utf-8",
  );
  const match = source.match(/matcher:\s*(\[[^\]]*\])/);
  if (!match) {
    throw new Error(
      "src/proxy.ts から config.matcher の literal を抽出できなかった(正規表現不一致)",
    );
  }
  currentMatcher = JSON.parse(match[1].replace(/'/g, '"'));
});

function matchesCurrentMatcher(pathname: string): boolean {
  return currentMatcher.some((entry) => entry === pathname);
}

type Case = { path: string; shouldMatch: boolean; label: string };

const CASES: Case[] = [
  { path: "/api/cards", shouldMatch: false, label: "/api/cards は Proxy 非該当であるべき" },
  { path: "/api/cards/export", shouldMatch: false, label: "/api/cards/export は Proxy 非該当であるべき" },
  { path: "/api/cards/abc123/verification", shouldMatch: false, label: "/api/cards/{id}/verification は Proxy 非該当であるべき" },
  { path: "/", shouldMatch: true, label: "/ は Proxy 該当であるべき" },
  { path: "/missions/my-mission", shouldMatch: true, label: "/missions/{slug} は Proxy 該当であるべき" },
  { path: "/verification-queue", shouldMatch: true, label: "/verification-queue は Proxy 該当であるべき" },
  { path: "/login", shouldMatch: false, label: "/login は Proxy 非該当であるべき" },
  { path: "/api/auth/session", shouldMatch: false, label: "/api/auth/** は Proxy 非該当であるべき" },
  { path: "/_next/static/chunk.js", shouldMatch: false, label: "/_next/** は Proxy 非該当であるべき" },
];

describe("matcher RED: 現行 config.matcher(['/', '/api/cards']) は期待契約の一部を満たさない", () => {
  for (const c of CASES) {
    it(`${c.label} (path=${c.path})`, () => {
      expect(matchesCurrentMatcher(c.path)).toBe(c.shouldMatch);
    });
  }
});
