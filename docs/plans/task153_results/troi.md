# task_153 Phase5 (Troi) — 再工程統合判断・PR本文構成の根拠

## 前提確認

- depends_on: task_153_beverly — Phase4R(Beverly rework)が全ステップ完了(commit 5a042ae)していることを
  dashboard.md で確認してから着手した。
- rework doc `docs/plans/20260721_task153_rework.md` §8(line313-323)を一次資料として使用。
  「元計画のPhase5をそのまま実施し、PR本文に差し戻し経緯を追記する」という指示のとおり、
  元計画Phase5の項目(本番影響/変更内容/理由/テスト方法/スコープ外/解釈確認事項/提督の残手動確認項目/
  現状の引き渡し状態)を維持したまま、rework専用セクション(差し戻し・再工程の経緯)を新規追加した。

## Step1: 設計書3件の追跡化

`git log --oneline -- <path>` で3件とも未追跡(履歴なし)と確認。`git ls-files --error-unmatch` でも
非追跡を二重確認。`.gitignore` に `.claude/` を追加後、3件を `git add` してcommit(395c8a8)・push済み。

## Step2: permissions-design.md 追記

追記前に既存111行を全読し、owner env / watchdog認証の記載が無いことを確認(grepでも0件)。
記述精度のため、`src/lib/deployment-validation.ts`(OWNER_ENV_KEYS・PLACEHOLDER_VALUES判定)と
`src/app/internal/health/watchdog/route.ts`(timing-safe SHA-256 digest比較・認証を依存先チェックより
先に確定・401時に接続文字列/hostname/error stackを含めない設計)を実装から直接確認し、それに基づいて
2セクションを追記(commit 8433f52)。二重記載を避けるため既存記述の書き換えは行っていない。

## Step3: PR本文構成の根拠

- **本番影響を冒頭に**: task指示・rework doc §8 双方が明記する必須事項のため、PR本文の最上段に配置。
- **テスト数値の精度**: task YAMLの草稿は「test-watchdog-integration.ps1: 実TLS経路6項目PASS」だったが、
  dashboard.md実測(Geordi Phase2R報告)は「PASS 7/7・EXIT=0(項目1/2a/2b/3/4/5/6)」。項目2がok/badの
  2アサーションに分割されているため概念上6項目・実アサーション数7という関係。PR本文では実測の7/7を
  主とし、6項目との対応関係を括弧で説明して数値の齟齬が生じないようにした。
- **差し戻し経緯セクション**: rework doc §8の指示通り、5件のバグ(2件Critical・1件Picard新規発見)を
  番号付きで列挙し、test-watchdog-integration.ps1がamun稼働スタック前提でCI/Mac実行不可である旨を
  明記した。
- **Beverly Phase4R実証の要約**: dashboard.mdのStep1〜Step9の実測結果(especially Step5=DoD#4本体)を
  そのまま転記し、数値を捏造・要約しすぎないよう原文の findings/sent 値を保持した。
- **解釈確認事項**: 「job runner疑似障害はPhase0に対象なし」という解釈をPR本文に明記し、Phase0 DoD
  reviewでの確認を仰ぐ形にした(task YAML通り)。

## マージ範囲の遵守

`gh pr create` のみ実行、マージ・承認は一切行っていない(deadlock-peer-review-gate厳守)。
