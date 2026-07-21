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
