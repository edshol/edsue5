# 即時反映：CF の publish → シートをすぐ作り直す

```
CF を publish
  → AEM のイベント（Adobe I/O Events「Content Fragment Published」）
  → この App Builder アクション（cf-sheets/dispatch）
  → GitHub repository_dispatch（cf-published）
  → ワークフロー「CF sheets」が該当シートだけ作り直してコミット（通常1分前後）
```

10分ごとの定期実行はそのまま残るので、イベントが届かなかった場合も最大10分で反映されます。

## 一度だけ行う設定

### 1. GitHub のトークン
- GitHub → Settings → Developer settings → **Fine-grained token**
- Repository access：`edshol/edsue5` のみ
- Permissions：**Contents: Read and write**（repository_dispatch に必要）
- このフォルダに `.env` を作る（Git には入れません）
  ```
  GITHUB_TOKEN=github_pat_xxxx
  ```

### 2. App Builder にデプロイ
```sh
cd tools/cf-sheets/dispatcher
aio login
aio app use            # 組織 Demo APAC → プロジェクト／ワークスペースを選ぶ（App Builder テンプレートで作成したもの）
aio app deploy
```

### 3. AEM のイベントをアクションにつなぐ（Adobe Developer Console）
1. 同じプロジェクト／ワークスペース → **Add service → Event**
2. **AEM Sites Events** を選び、環境 `p236456-e2388687`（author）を選ぶ
3. イベント：**Content Fragment Published**（必要なら Unpublished / Deleted も）
4. 受け取り方：**Runtime action** → `cf-sheets/dispatch`
5. 保存

※ AEM のイベント機能（AEM Eventing）が、この環境で有効になっている必要があります。

## 確認
- CF を publish する → GitHub の Actions に「CF sheets」が `repository_dispatch` で起動する
- ログ：`aio rt activation list` / `aio rt activation logs <id>`

## 対象のフォルダを増やすとき
`app.config.yaml` の `SHEET_ROUTES` に「DAM のパスの先頭 → シート名」を追加し、`aio app deploy` し直します（シート名は `tools/cf-sheets/config.json` と同じにします）。

## ローカルでのテスト
```sh
node actions/dispatch/test.js   # GitHub への送信はモック（実際には送らない）
```
