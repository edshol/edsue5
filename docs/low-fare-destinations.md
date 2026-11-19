# Low Fare Destinations（Universal Editor ＋ Content Fragment）

## 役割分担

| 何を | どこで | 誰が |
|---|---|---|
| 行き先のデータ（空港コード・都市名・写真・リンク） | Content Fragment `destination`（`/content/dam/eds-ue/destinations/`） | 1回だけ作り、全部の国で使い回す |
| どの行き先を、どの順で出すか | ページの Low Fare Destinations ブロック（UE） | 各国の担当者 |
| 出発地 | ページのパス（国）から自動で決まる | 入力しない |
| 価格 | 運賃 API から自動取得 | 入力しない |

## 1. CF モデル `destination`（AEM）

場所：`/conf/eds-ue/settings/dam/cfm/models/destination`

| フィールド | 名前（GraphQL） | 型 | 入力チェック |
|---|---|---|---|
| Airport Code | `airportCode` | 1行テキスト | 必須、`^[A-Z]{3}$`、一意 |
| City Name | `cityName` | 1行テキスト | 必須、最大 60 文字（翻訳対象） |
| Image (Portrait / Mobile) | `imagePortrait` | コンテンツ参照（画像のみ） | 必須、`/content/dam` 配下 |
| Image (Landscape / Desktop) | `imageLandscape` | コンテンツ参照（画像のみ） | 任意（無ければ Portrait を使用） |
| Link | `link` | 1行テキスト | 任意 |

CF の置き場所：`/content/dam/eds-ue/destinations/`（このフォルダに `destination` モデルだけを許可）。
ブロックの入力欄でも、このフォルダ以外は選べないようにしています（`validation.rootPath`）。

## 2. GraphQL 永続クエリ `eds-ue/destinations`

```graphql
query {
  destinationList(filter: { _path: { _expressions: [{ value: "/content/dam/eds-ue/destinations/", _operator: STARTS_WITH }] } }) {
    items {
      _path
      airportCode
      cityName
      link
      imagePortrait { ... on ImageRef { _path _publishUrl _dynamicUrl } }
      imageLandscape { ... on ImageRef { _path _publishUrl _dynamicUrl } }
    }
  }
}
```

- 全部の行き先を1回のリクエストで取得し、CDN にキャッシュされます。ブロックは必要な CF だけを使います。
- UE（AEM author）では author の同じドメインから下書きの内容を読み、`.aem.page` / `.aem.live` では AEM Publish から読みます。
- **Publish 側で CORS の設定が必要です：** `https://*.aem.page`、`https://*.aem.live`（と本番ドメイン）から `/graphql/execute.json/*` を GET できるようにします（AEM のコードリポジトリの OSGi 設定 `com.adobe.granite.cors.impl.CORSPolicyImpl~eds.cfg.json`）。

## 3. 出発地はパスで決める（`scripts/market.js`）

1. ページのメタデータ `origin` / `origin-city`（一括メタデータ `/content/eds-ue/metadata` で国ごとに設定）
   | URL | origin | origin-city |
   |---|---|---|
   | /my/** | KUL | Kuala Lumpur |
   | /sg/** | SIN | Singapore |
2. 無ければ、パスの先頭（`/my/...`、`/sg/...`）からコードに書いた既定値（`MARKET_ORIGINS`）を使います。※ 国ごとの既定空港は MAG に確認してください。
3. `?origin=SIN` は確認用です。localhost、`*.aem.page`、AEM author でだけ有効で、本番（`*.aem.live`、本番ドメイン）では無視されます。

出発地と同じ空港の行き先（例：KUL のページの Kuala Lumpur）は自動で表示しません。

## 4. 価格（入力させない）

- ページのメタデータ `low-fare-api`（一括メタデータで全体に設定）の URL テンプレート `...{origin}...{destination}...`、またはシート形式（Origin / Destination / Price / Currency）。
- 未設定のときはデモ用の `/data/demo-fares.json` を使います。**本番前に実際の運賃 API に置き換えてください。**
- 価格が取れない行き先は「All-in return from」も含めて自動で隠します。

## 5. UE での入力チェック

- Title：必須、最大 80 文字。都市名は自動で付くので入力しない旨を説明に表示
- Destination：必須、`/content/dam/eds-ue/destinations` 配下の CF だけ選択可
- 存在しない CF や出発地と同じ空港を選ぶと、**UE の中でだけ**赤い点線のタイルで警告します（公開ページには出しません）
- 最大 15 件
