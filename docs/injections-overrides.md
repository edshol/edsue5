# Overrides と Injections（CF で管理）

ページを編集せずに、任意のページの要素をすぐ変えるための仕組みです（AEM の「Script executor」の置き換え）。

| | Overrides（JS なし） | Injections（JS あり） |
|---|---|---|
| CF モデル | MH Override | MH Injection |
| 置き場所（ここ以外は読まない） | `/content/dam/hol/overrides` | `/content/dam/hol/injections` |
| できること | hide / show / text / html / attr / add-class / remove-class / remove | 任意の JavaScript |
| 読み込み | `scripts/overrides.js` | `scripts/injections.js` |
| API（永続クエリ） | `global/overrides` | `global/injections` |

## 反映の流れ
- CF を編集して **Publish** すると、約10秒で aem.live / aem.page に反映されます（キャッシュ10秒）。
- AEM author でページを直接開くと、**publish 前の下書き CF** が使われます。公開前の確認に使えます。
- UE の編集画面（iframe）では実行しません。原文を編集できるようにするためです。確認したいときは `?injections=on` / `?overrides=on` を付けます。

## 対象ページの指定（両方共通）
- **paths**：サイトのパスの glob で指定します（例：`/hol/my/en/*`、`/hol/*/en/lowfare-test`）。空にすると全ページが対象です。
- **exclude**：除外するページの glob です。
- **device**：all / desktop / mobile から選びます。
- **start / end**：有効期間です（任意）。
- **enabled**：オフにすると、CF を消さずに止められます。

## Injection の Script
async 関数の中で実行されるので、`await` と `return` が使えます。
```js
const tile = await inject.waitFor('.low-fare-destinations .lfd-tile[data-destination="MEL"]');
if (!tile) return;
tile.classList.add('promo');
inject.log('done');
```
- `inject.waitFor(selector, { timeout })`：要素が現れるまで待ちます。見つからなければ null を返します（既定は10秒）。
- `inject.log(...)`：DevTools に `[injection INJ-001]` 付きでログを出します。
- エラーは CF ごとに捕まえるので、ほかの Injection やページは止まりません。DevTools では `injections/INJ-001.js` として表示されます。
- **timing**：lazy（ブロック描画後・通常）/ eager（最初の表示前）/ delayed（3秒後）から選びます。

## 権限と履歴
- **権限：** `/content/dam/hol/injections` フォルダの書き込み権限を、専用グループ（例：`hol-injection-editors`）だけに与えます（AEM → Tools → Security → Permissions）。
- **履歴：** CF のバージョン履歴（Timeline / Versions）と、publish の監査ログに残ります。
- **止め方：**
  - 1件だけ止める：enabled をオフにして Publish する
  - ページ単位で止める：ページのメタデータに `injections: off` を入れる
  - 確認用：URL に `?injections=off` / `?overrides=off` を付ける

## セットアップ（済み）
- CF モデル：MH Injection / MH Override（`/conf/global`）
- 永続クエリの登録：`AEM_TOKEN=… node tools/cf-sheets/persist-queries.mjs` を実行して、publish する
