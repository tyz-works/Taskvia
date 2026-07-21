# task_153 Phase1(Worf) RED — 実出力記録

作成: 2026-07-21 / commit: ff7918f

## amun RED確認(ops/watchdog/test-watchdog-lib.ps1)

### 試行1: 誤判定(EXIT=0)

原因: ssh経由のシェルクォート二重解釈でUNCパスの先頭バックスラッシュが2本のつもりが1本に劣化した
(正しいUNCパスは先頭がバックスラッシュ2連続だが、1連続に減ってしまった)。PowerShellはファイルパス自体を発見できず
"-File パラメーターの引数...は存在しません"エラーで即終了、EXIT=0(watchdog-lib.ps1のdot-source失敗による
RED未満・偽陽性)。
```
EXIT=0
```

対処: 計画書 line414 通りのエスケープ(quadruple backslash)に修正 → EXIT=1 になったが原因が別物だった(下記試行2)。

### 試行2: EXIT=1だが原因がParserError(想定外・OBSERVE→HYPOTHESIZE→TEST→FIX実施)

**OBSERVE**: test-watchdog-lib.ps1 内の日本語文字列(例: `'backoff(15分)...'`)付近で
PowerShellパーサーが "MissingEndParenthesisInExpression" エラー。watchdog-lib.ps1不在によるdot-source失敗ではない。

**HYPOTHESIS**: Write ToolでUTF-8(BOM無し)で生成した.ps1ファイルを、Windows PowerShell 5.1が
システムANSIコードページ(CP932)で読み込み、日本語マルチバイトシーケンスを誤って括弧やクォートと解釈した。

**TEST**: ファイル先頭にUTF-8 BOM(EF BB BF)を付与し、amunへ再転送・再実行。

**FIX確認**: BOM付与後、パースエラーは解消し、期待通り watchdog-lib.ps1 の dot-source 失敗
(CommandNotFoundException)による EXIT=1 に変わった。→ 下記が最終RED実出力。

**★Phase2(Geordi)への申し送り**: watchdog-lib.ps1 に日本語(全角文字)を含むコメント等を書く場合、
UTF-8 BOM付きで保存しないと Windows PowerShell 5.1(WSL2 UNCパス経由)がCP932としてパースし壊れる。
test-watchdog-lib.ps1 は本修正を適用済み(commit ff7918f)。

### 最終RED確認 実出力(生ログ・amunから直接取得。CP932文字化けは想定内 — 判定はEXIT codeと
英字部分 `CommandNotFoundException` / `ObjectNotFound` で行う。§18.2に基づきトークンは含まれていない)

```
. : �p�� '\\wsl.localhost\Ubuntu-24.04\home\tkadmin\taskvia\ops\watchdog\watchdog-lib.ps1' �́A�R�}���h���b�g�A�֐��A�X�N
���v�g �t�@�C���A�܂��͑���\�ȃv���O�����̖��O�Ƃ��ĔF������܂���B���O���������L�q����Ă��邱�Ƃ��m�F���A�p�X���܂�
��Ă���ꍇ�͂��̃p�X�����������Ƃ��m�F���Ă���A�Ď��s���Ă��������B
�����ꏊ \\wsl.localhost\Ubuntu-24.04\home\tkadmin\taskvia\ops\watchdog\test-watchdog-lib.ps1:13 ����:3
+ . "$PSScriptRoot\watchdog-lib.ps1"
+   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : ObjectNotFound: (\\wsl.localhost...atchdog-lib.ps1:String) [], ParentContainsErrorRecord 
   Exception
    + FullyQualifiedErrorId : CommandNotFoundException
 
EXIT=1
```

**判定**: EXIT=1、`CategoryInfo: ObjectNotFound` / `FullyQualifiedErrorId: CommandNotFoundException`、
エラー発生箇所が `test-watchdog-lib.ps1:13` の `. "$PSScriptRoot\watchdog-lib.ps1"` 行 → 期待通り
watchdog-lib.ps1 が存在せず dot-source に失敗している(RED達成)。

## vitest RED確認(tests/deployment-validation.test.ts のみ)

```

> taskvia@0.1.0 test
> vitest run tests/deployment-validation.test.ts


 RUN  v4.1.10 /Users/tyz/workspace/taskvia

 ❯ tests/deployment-validation.test.ts (23 tests | 22 failed) 60ms
     × 6 項目すべてが実値なら ok=true・missing は空 8ms
     × TASKVIA_OPERATOR_ID が未設定なら ok=false で missing に含まれる 2ms
     × TASKVIA_OPERATOR_ALERT が未設定なら ok=false で missing に含まれる 1ms
     × TASKVIA_BACKUP_OWNER_ID が未設定なら ok=false で missing に含まれる 1ms
     × TASKVIA_BACKUP_OWNER_ALERT が未設定なら ok=false で missing に含まれる 1ms
     × TASKVIA_SECURITY_OWNER_ID が未設定なら ok=false で missing に含まれる 1ms
     × TASKVIA_SECURITY_OWNER_ALERT が未設定なら ok=false で missing に含まれる 1ms
     × TASKVIA_OPERATOR_ID が空白のみなら未設定として扱う 1ms
     × TASKVIA_OPERATOR_ALERT が空白のみなら未設定として扱う 1ms
     × TASKVIA_BACKUP_OWNER_ID が空白のみなら未設定として扱う 1ms
     × TASKVIA_BACKUP_OWNER_ALERT が空白のみなら未設定として扱う 1ms
     × TASKVIA_SECURITY_OWNER_ID が空白のみなら未設定として扱う 1ms
     × TASKVIA_SECURITY_OWNER_ALERT が空白のみなら未設定として扱う 1ms
     × プレースホルダ値 TODO は未設定として扱う 1ms
     × プレースホルダ値 todo は未設定として扱う 1ms
     × プレースホルダ値 changeme は未設定として扱う 1ms
     × プレースホルダ値 CHANGEME は未設定として扱う 1ms
     × プレースホルダ値 unset は未設定として扱う 1ms
     × task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の素通り防止) 1ms
     × 複数欠落時は missing にすべて列挙される 1ms
     × TASKVIA_TOKEN があっても owner が未設定なら 503 3ms
     × 503 応答に欠落した変数名は含めるが、値・token・接続文字列は含めない(§14.2 の情報漏洩禁止) 2ms

⎯⎯⎯⎯⎯⎯ Failed Tests 22 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > 6 項目すべてが実値なら ok=true・missing は空
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:35:42
     33| describe("validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identit…
     34|   it("6 項目すべてが実値なら ok=true・missing は空", async () => {
     35|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     36|     const result = validateDeploymentOwners(validEnv());
     37|     expect(result.ok).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ID が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ALERT が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ID が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ALERT が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ID が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ALERT が未設定なら ok=false で missing に含まれる
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:42:42
     40|
     41|   it.each(ALL_KEYS)("%s が未設定なら ok=false で missing に含まれる", async (key) …
     42|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     43|     const env = validEnv();
     44|     delete (env as Record<string, string | undefined>)[key];

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ID が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ALERT が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ID が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ALERT が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ID が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ALERT が空白のみなら未設定として扱う
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:51:42
     49|
     50|   it.each(ALL_KEYS)("%s が空白のみなら未設定として扱う", async (key) => {
     51|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     52|     const env = validEnv();
     53|     env[key] = "   ";

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 TODO は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 todo は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 changeme は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 CHANGEME は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 unset は未設定として扱う
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:62:44
     60|     "プレースホルダ値 %s は未設定として扱う",
     61|     async (placeholder) => {
     62|       const { validateDeploymentOwners } = await import("@/lib/deploym…
       |                                            ^
     63|       const env = validEnv();
     64|       env.TASKVIA_OPERATOR_ID = placeholder;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の素通り防止)
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:72:42
     70|
     71|   it("task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の…
     72|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     73|     const env = validEnv();
     74|     env.TASKVIA_BACKUP_OWNER_ID = "backup_owner";

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > 複数欠落時は missing にすべて列挙される
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:81:42
     79|
     80|   it("複数欠落時は missing にすべて列挙される", async () => {
     81|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     82|     const result = validateDeploymentOwners({});
     83|     expect(result.ok).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/22]⎯

 FAIL  tests/deployment-validation.test.ts > /api/health: owner 未設定で deployment validation が失敗する > TASKVIA_TOKEN があっても owner が未設定なら 503
AssertionError: expected 200 to be 503 // Object.is equality

- Expected
+ Received

- 503
+ 200

 ❯ tests/deployment-validation.test.ts:125:24
    123|     const { GET } = await import("@/app/api/health/route");
    124|     const res = await GET();
    125|     expect(res.status).toBe(503);
       |                        ^
    126|   });
    127|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/22]⎯

 FAIL  tests/deployment-validation.test.ts > /api/health: owner 未設定で deployment validation が失敗する > 503 応答に欠落した変数名は含めるが、値・token・接続文字列は含めない(§14.2 の情報漏洩禁止)
AssertionError: expected '{"status":"ok"}' to contain 'TASKVIA_OPERATOR_ID'

Expected: "TASKVIA_OPERATOR_ID"
Received: "{"status":"ok"}"

 ❯ tests/deployment-validation.test.ts:134:18
    132|     const res = await GET();
    133|     const text = JSON.stringify(await res.json());
    134|     expect(text).toContain("TASKVIA_OPERATOR_ID");
       |                  ^
    135|     expect(text).not.toContain("super-secret-token-value");
    136|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/22]⎯


 Test Files  1 failed (1)
      Tests  22 failed | 1 passed (23)
   Start at  14:20:22
   Duration  246ms (transform 29ms, setup 0ms, import 34ms, tests 60ms, environment 0ms)

```

**判定**: 22 failed / 1 passed (23 total)。失敗理由は全て予期通り:
- `Cannot find package '@/lib/deployment-validation'`(20件・validateDeploymentOwners未実装)
- `expected 200 to be 503`(/api/health がowner検証未実装のまま200を返す)
- `expected '{"status":"ok"}' to contain 'TASKVIA_OPERATOR_ID'`(503応答body自体が無い)
1件のみ既存動作で偶然PASS(owner全項目+TASKVIA_TOKENが揃った200ケース=検証追加前でも成立するテスト)。

## vitest 全体実行(既存32件無傷確認)

```

> taskvia@0.1.0 test
> vitest run


 RUN  v4.1.10 /Users/tyz/workspace/taskvia

 ❯ tests/deployment-validation.test.ts (23 tests | 22 failed) 149ms
     × 6 項目すべてが実値なら ok=true・missing は空 15ms
     × TASKVIA_OPERATOR_ID が未設定なら ok=false で missing に含まれる 6ms
     × TASKVIA_OPERATOR_ALERT が未設定なら ok=false で missing に含まれる 11ms
     × TASKVIA_BACKUP_OWNER_ID が未設定なら ok=false で missing に含まれる 4ms
     × TASKVIA_BACKUP_OWNER_ALERT が未設定なら ok=false で missing に含まれる 9ms
     × TASKVIA_SECURITY_OWNER_ID が未設定なら ok=false で missing に含まれる 7ms
     × TASKVIA_SECURITY_OWNER_ALERT が未設定なら ok=false で missing に含まれる 5ms
     × TASKVIA_OPERATOR_ID が空白のみなら未設定として扱う 2ms
     × TASKVIA_OPERATOR_ALERT が空白のみなら未設定として扱う 4ms
     × TASKVIA_BACKUP_OWNER_ID が空白のみなら未設定として扱う 2ms
     × TASKVIA_BACKUP_OWNER_ALERT が空白のみなら未設定として扱う 1ms
     × TASKVIA_SECURITY_OWNER_ID が空白のみなら未設定として扱う 2ms
     × TASKVIA_SECURITY_OWNER_ALERT が空白のみなら未設定として扱う 9ms
     × プレースホルダ値 TODO は未設定として扱う 4ms
     × プレースホルダ値 todo は未設定として扱う 6ms
     × プレースホルダ値 changeme は未設定として扱う 2ms
     × プレースホルダ値 CHANGEME は未設定として扱う 2ms
     × プレースホルダ値 unset は未設定として扱う 1ms
     × task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の素通り防止) 1ms
     × 複数欠落時は missing にすべて列挙される 1ms
     × TASKVIA_TOKEN があっても owner が未設定なら 503 3ms
     × 503 応答に欠落した変数名は含めるが、値・token・接続文字列は含めない(§14.2 の情報漏洩禁止) 2ms

⎯⎯⎯⎯⎯⎯ Failed Tests 22 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > 6 項目すべてが実値なら ok=true・missing は空
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:35:42
     33| describe("validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identit…
     34|   it("6 項目すべてが実値なら ok=true・missing は空", async () => {
     35|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     36|     const result = validateDeploymentOwners(validEnv());
     37|     expect(result.ok).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ID が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ALERT が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ID が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ALERT が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ID が未設定なら ok=false で missing に含まれる
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ALERT が未設定なら ok=false で missing に含まれる
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:42:42
     40|
     41|   it.each(ALL_KEYS)("%s が未設定なら ok=false で missing に含まれる", async (key) …
     42|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     43|     const env = validEnv();
     44|     delete (env as Record<string, string | undefined>)[key];

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ID が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_OPERATOR_ALERT が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ID が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_BACKUP_OWNER_ALERT が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ID が空白のみなら未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > TASKVIA_SECURITY_OWNER_ALERT が空白のみなら未設定として扱う
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:51:42
     49|
     50|   it.each(ALL_KEYS)("%s が空白のみなら未設定として扱う", async (key) => {
     51|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     52|     const env = validEnv();
     53|     env[key] = "   ";

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 TODO は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 todo は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 changeme は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 CHANGEME は未設定として扱う
 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > プレースホルダ値 unset は未設定として扱う
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:62:44
     60|     "プレースホルダ値 %s は未設定として扱う",
     61|     async (placeholder) => {
     62|       const { validateDeploymentOwners } = await import("@/lib/deploym…
       |                                            ^
     63|       const env = validEnv();
     64|       env.TASKVIA_OPERATOR_ID = placeholder;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の素通り防止)
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:72:42
     70|
     71|   it("task_150 の既定値 backup_owner は実 identity として認めない(ops/backup.sh:6 の…
     72|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     73|     const env = validEnv();
     74|     env.TASKVIA_BACKUP_OWNER_ID = "backup_owner";

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/22]⎯

 FAIL  tests/deployment-validation.test.ts > validateDeploymentOwners: Phase 0 DoD #6 — 3 owner の identity/alert destination 検証 > 複数欠落時は missing にすべて列挙される
Error: Cannot find package '@/lib/deployment-validation' imported from /Users/tyz/workspace/taskvia/tests/deployment-validation.test.ts
 ❯ tests/deployment-validation.test.ts:81:42
     79|
     80|   it("複数欠落時は missing にすべて列挙される", async () => {
     81|     const { validateDeploymentOwners } = await import("@/lib/deploymen…
       |                                          ^
     82|     const result = validateDeploymentOwners({});
     83|     expect(result.ok).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/22]⎯

 FAIL  tests/deployment-validation.test.ts > /api/health: owner 未設定で deployment validation が失敗する > TASKVIA_TOKEN があっても owner が未設定なら 503
AssertionError: expected 200 to be 503 // Object.is equality

- Expected
+ Received

- 503
+ 200

 ❯ tests/deployment-validation.test.ts:125:24
    123|     const { GET } = await import("@/app/api/health/route");
    124|     const res = await GET();
    125|     expect(res.status).toBe(503);
       |                        ^
    126|   });
    127|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/22]⎯

 FAIL  tests/deployment-validation.test.ts > /api/health: owner 未設定で deployment validation が失敗する > 503 応答に欠落した変数名は含めるが、値・token・接続文字列は含めない(§14.2 の情報漏洩禁止)
AssertionError: expected '{"status":"ok"}' to contain 'TASKVIA_OPERATOR_ID'

Expected: "TASKVIA_OPERATOR_ID"
Received: "{"status":"ok"}"

 ❯ tests/deployment-validation.test.ts:134:18
    132|     const res = await GET();
    133|     const text = JSON.stringify(await res.json());
    134|     expect(text).toContain("TASKVIA_OPERATOR_ID");
       |                  ^
    135|     expect(text).not.toContain("super-secret-token-value");
    136|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/22]⎯


 Test Files  1 failed | 7 passed (8)
      Tests  22 failed | 33 passed (55)
   Start at  14:20:22
   Duration  11.85s (transform 215ms, setup 0ms, import 331ms, tests 12.01s, environment 1ms)

```

**判定**: Test Files 1 failed(新規ファイルのみ) | 7 passed(既存ファイル全て)。
Tests 22 failed | 33 passed(既存32件 + 新規1件偶然PASS)。既存32件は無傷。

---

# task_153 Phase1R(Worf, rework) RED — 実出力記録

追記: 2026-07-21 / commit: dee4446(push済み・origin/feature/task_153) / rework doc: docs/plans/20260721_task153_rework.md

Phase4(Beverly)差し戻しを受けたPicard裁定の再工程。5件のバグ(Beverly発見4件+Picard新規発見1件
=バグ5・state file UTCラウンドトリップの+9hずれ)の回帰pinを、実TLS経路を通す統合テストとして新設した。

## 成果物

- `ops/watchdog/test-watchdog-integration.ps1`(新設・UTF-8 BOM付き): 実TLS経路7アサーション
  (項目1・2a・2b・3・4・5・6)。稼働中のamun実スタックへの実HTTPを通す。
  隔離: 自前の一時config/一時state fileのみ使用、C:\ProgramData\Taskvia\配下は一切触れない。
  ntfy_urlはダミー不到達先。正しいtokenはcompose.yamlから実行時に読み取り(ハードコードしない)。
- `ops/watchdog/test-watchdog-lib.ps1`(既存29件は無変更): `ConvertTo-WatchdogUtcTime`契約を2件追加
  (compact形式"20260721T063950Z"=バグ4 pin、extended形式"2026-07-21T06:39:50Z"=バグ5 pin)。
  未定義関数呼び出しがterminating errorになるためAssert-UtcTimeParseヘルパーでtry/catch保護し、
  最終行のTEST-RESULT出力に必ず到達するようにした。

## amun RED実測1: test-watchdog-integration.ps1

```
コマンド: ssh amun powershell.exe -File test-watchdog-integration.ps1
```

生ログ(CP932文字化けは想定内。判定はexit codeと`TEST-RESULT`行のみで行う):

```
FAIL: ����1: ������token�Ŏ�TLS�o�H(https://localhost/...)��HTTP200(probe=ok)�ɓ��B����(�o�O2 ��Apin) | expected=<ok> actual=<unreachable>
FAIL: ����4: �ؖ�������callback���ʃX���b�h�Ăяo���ŗ�O�����Ȃ�(PSInvalidOperationException���������Ȃ�, �o�O2 ��Apin ? ����1��probe=ok���B�Ŋm�F)
FAIL: ����5: state file��UTC���E���h�g���b�v���s���_(������first_seen�Ɠǂݖ߂���̒l�����S��v, �o�O5 ��Apin) | expected=<2026-07-20T06:39:50Z> actual=<2026-07-20T15:39:50Z>
FAIL: ����6: watchdog�{�̂�1����s��WATCHDOG-RUN: probe=ok�ɓ��B����(E2E���B��) | expected=<ok> actual=<unreachable>
FAIL: ����2a: ��token�Ŏ�TLS�o�H��HTTP401(probe=unauthorized)�ɓ��B���� | expected=<unauthorized> actual=<unreachable>
ok: ����2b: ��token���s���̏o�͂�token�l�E�ڑ�������E����hostname���܂܂Ȃ�(��14.2)
ok: ����3: IP literal(https://127.0.0.1/...)�͓��B�ł��Ȃ�(�o�O1�E���m�̐���̉�Apin)
TEST-RESULT: FAIL 2/7
EXIT=1
```

**判定**: `TEST-RESULT: FAIL 2/7`, `EXIT=1`。7アサーション中訳(FAIL項目のexpected/actualはmojibake内だが
英数字部分で判読可能):

| 項目 | 結果 | 内容 |
|---|---|---|
| 1 | **FAIL** | 正しいtokenでHTTP200到達 — expected=ok actual=unreachable(バグ2でTLSハンドシェイク失敗) |
| 2a | **FAIL** | 誤tokenでHTTP401到達 — expected=unauthorized actual=unreachable(バグ2により401まで到達できない、doc予告通り) |
| 2b | ok(PASS) | 誤token失敗時の出力にtoken/内部hostname/接続文字列を含まない |
| 3 | ok(PASS) | IP literal(127.0.0.1)は到達できない(バグ1・既知の制約pin。現行コードでも成立) |
| 4 | **FAIL** | 証明書検証callbackが例外化しない(項目1のprobe=ok到達で確認する設計のため項目1と連動してFAIL) |
| 5 | **FAIL** | state file UTCラウンドトリップ不動点 — expected=2026-07-20T06:39:50Z actual=2026-07-20T15:39:50Z
  (★ちょうど+9h=JSTオフセット分ずれており、バグ5=ConvertTo-WatchdogUtcの[datetime]::Parseが
  Zサフィックスをローカル変換してしまう不具合をピンポイントで実証) |
| 6 | **FAIL** | watchdog本体1回実行でWATCHDOG-RUN: probe=okに到達 — expected=ok actual=unreachable |

rework doc §4.1の予告("項目1・2・4・5・6がFAILし項目3のみPASSする")と完全一致
(項目2は2a/2bに分割したが、2aがFAILするため項目2全体としてもFAILの主張と整合)。

## amun RED実測2: test-watchdog-lib.ps1(既存29件+新規2件)

```
ok: healthy �� probe + �V�N�� backup �ł� finding 0 ��
ok: ���B�s�\�� finding 1 ��
ok: ���B�s�\�� dedup_key
ok: ���B�s�\�� severity
ok: 401 �� dedup_key
ok: 401 �� severity
ok: 502 �� dedup_key
ok: redis �ُ�� finding 1 ��
ok: dependency �� dedup_key
ok: dependency �� severity
ok: dependency_signals �O�̈ˑ���ُ�� finding �ɂ��Ȃ�
ok: backup 27h �o�߂� backup_stale
ok: backup 25h ��臒l���� finding 0 ��
ok: backup ����x�������ꍇ�� backup_stale
ok: manifest �ǎ�s�\�ł� finding �� 1 ���̂�(backup_stale �Əd�����񂵂Ȃ�)
ok: manifest �ǎ�s�\�� backup_marker_unreadable
ok: restore test 36 ���� restore_test_stale
ok: �V�K finding �Œʒm 1 ��
ok: �V�K finding �� kind �� alert
ok: �V�K finding �� dedup_key
ok: backoff(15��) ���o�߂� 5 ����͍Ēʒm���Ȃ�
ok: backoff(15��) �o�ߌ�͍Ēʒm����
ok: 2 ��ڒʒm��� 30 ���K�v(20 ���ł͍Ēʒm���Ȃ�)
ok: alert_max_notifications=5 ���B��͒ʒm���Ȃ�
ok: �������ɒʒm 1 ��
ok: �������� kind �� resolved
ok: resolved ���M��͓�x�ƒʒm���Ȃ�
ok: �z�����s���� signal �Ƃ��ċL�^�����
ok: �z�����s��� backoff ��҂�������đ�����
FAIL: ConvertTo-WatchdogUtcTime: compact�`��(20260721T063950Z)��2026-07-21 06:39:50 Kind=Utc(�o�O4 pin) | error=<�p�� 'ConvertTo-WatchdogUtcTime' �́A�R�}���h���b�g�A�֐��A�X�N���v�g �t�@�C���A�܂��͑���\�ȃv���O�����̖��O�Ƃ��ĔF������܂���B���O���������L�q����Ă��邱�Ƃ��m�F���A�p�X���܂܂�Ă���ꍇ�͂��̃p�X�����������Ƃ��m�F���Ă���A�Ď��s���Ă��������B>
FAIL: ConvertTo-WatchdogUtcTime: extended�`��(2026-07-21T06:39:50Z)��2026-07-21 06:39:50 Kind=Utc(�o�O5 pin) | error=<�p�� 'ConvertTo-WatchdogUtcTime' �́A�R�}���h���b�g�A�֐��A�X�N���v�g �t�@�C���A�܂��͑���\�ȃv���O�����̖��O�Ƃ��ĔF������܂���B���O���������L�q����Ă��邱�Ƃ��m�F���A�p�X���܂܂�Ă���ꍇ�͂��̃p�X�����������Ƃ��m�F���Ă���A�Ď��s���Ă��������B>
TEST-RESULT: FAIL 29/31
EXIT=1
```

**判定**: `TEST-RESULT: FAIL 29/31`, `EXIT=1`。`ok:` 行29件(既存29件、1件も壊れていない)+
`FAIL:` 行2件(新規追加した`ConvertTo-WatchdogUtcTime`契約2件、いずれも
"term 'ConvertTo-WatchdogUtcTime' is not recognized"(CommandNotFoundExceptionのメッセージ、
watchdog-lib.ps1に未実装のためRED)。既存29件は完全に無傷。

## 隔離の確認

テスト実行前後でamunのデプロイ済みファイルに変化がないことを確認(タイムスタンプ・サイズ不変):

```

FullName                                    Length LastWriteTime      
--------                                    ------ -------------      
C:\ProgramData\Taskvia\watchdog-state.json    1746 2026/07/21 16:04:32
C:\ProgramData\Taskvia\watchdog-config.json    581 2026/07/21 14:44:27


```

テスト実行前の実測(本ミッション開始時点)と比較して `watchdog-state.json`(1746 bytes,
2026/07/21 16:04:32)・`watchdog-config.json`(581 bytes, 2026/07/21 14:44:27)ともに
サイズ・LastWriteTimeが一致 — 本テストによる書き込みが一切発生していないことを実測で確認した。

## push確認

```
$ git ls-remote origin feature/task_153
dee444690403ede9b891ead03c189c1d51a00009  refs/heads/feature/task_153
```

commit dee4446 が origin に到達していることを確認済み。

## Phase2R(Geordi)への申し送り

- `test-watchdog-integration.ps1`はGeordiが変更する必要はない(このまま`taskvia-watchdog.ps1`と
  `watchdog-lib.ps1`の修正を検証する)。Mac側では実行できないため、GREEN確認はamun実機で行うこと。
- `ConvertTo-WatchdogUtcTime`は`watchdog-lib.ps1`(純粋関数・I/Oなし)へ実装すること。
  引数=文字列1つ、戻り値=`[datetime]`(Kind=Utc)。実装方式(AssumeUniversal/AdjustToUniversal/
  手動UTC指定等)は問わない — 2つの形式(compact/extended)双方が
  `2026-07-21 06:39:50 Kind=Utc`になることのみが契約。
- `test-watchdog-integration.ps1`のRun A/B/Cはいずれも`taskvia-watchdog.ps1`をそのまま
  (call operator `&`で)実行して実プローブ結果を観測する設計。Phase2Rでの修正が
  `taskvia-watchdog.ps1`のTLS設定・証明書callback・`Read-WatchdogState`/`Save-WatchdogState`の
  日付変換呼び出しに反映されれば、このテストは自動的にGREEN化する(本テスト自体の変更は不要)。
