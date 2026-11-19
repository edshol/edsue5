# CF → JSON シート（「CF を更新するだけ」の仕組み）

## 流れ

```
オーサー：CF を編集して publish
   ↓
AEM Publish：GraphQL 永続クエリ（公開・認証なし）
   ↓  GitHub Actions「CF sheets」（10分ごと／手動／即時トリガー）
tools/cf-sheets/build.mjs が data/cf/<name>.json を生成してコミット
   ↓  EDS のコード同期
https://<branch>--edsue5--edshol.aem.page/data/cf/<name>.json（同じドメイン・CDN キャッシュ）
   ↓
ブロックが読み込んで表示
```

- オーサーの作業は「CF を編集して publish」だけです。シートを手で直す必要はありません。
- シートに入るのは **publish 済みの CF だけ**です（下書きは入らない）。UE の中（author）では、ブロックが Sites API で下書きを直接読むので、編集中の内容もすぐ確認できます。
- 写真などの参照は、Publish の URL（Web 最適化配信が有効なら `_dynamicUrl`）に変換して入れます。

## シートを追加するには

1. CF モデルに合わせた GraphQL クエリを `tools/cf-sheets/queries/<name>.graphql` に書く
2. `tools/cf-sheets/config.json` の `sheets` に追加する
   ```json
   { "name": "<name>", "persistedQuery": "global/<name>", "query": "queries/<name>.graphql",
     "list": "<modelName>List", "output": "data/cf/<name>.json" }
   ```
3. 永続クエリを AEM に作って publish する
   - コマンド：`AEM_TOKEN=<ローカル開発用トークン> node tools/cf-sheets/persist-queries.mjs`
   - または AEM の GraphiQL IDE で同じクエリを保存して publish
4. GitHub の Actions →「CF sheets」→ Run workflow（以後は自動）

## 安全策

- 取得に失敗した、または 0 件だった場合は、**前のシートを残して**エラー終了します（一時的な不具合でサイトが空になるのを防ぐ）。0 件を許可したいシートは `"allowEmpty": true`。
- 内容が変わっていなければコミットしません。
- 手動実行や即時トリガーで渡すシート名は英小文字・数字・ハイフンだけ受け付けます。

## 即時反映（任意）

10分待たずに反映したい場合は、CF の publish をきっかけに次を呼びます（Adobe I/O Events や AEM のワークフローから）。

```
POST https://api.github.com/repos/edshol/edsue5/dispatches
{ "event_type": "cf-published", "client_payload": { "sheet": "lowfare-destinations" } }
```

## ローカルでの確認

```sh
node tools/cf-sheets/build.mjs                       # Publish から生成
CF_FETCH_ORIGIN=http://localhost:3003 node tools/cf-sheets/build.mjs   # モックから生成
```
