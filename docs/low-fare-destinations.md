# Low Fare Destinations（Universal Editor ＋ Content Fragment）

## 役割分担

| 何を | どこで | 誰が |
|---|---|---|
| 行き先のデータ（空港コード・都市名・写真・リンク） | Content Fragment `destination`（`/content/dam/eds-ue/destinations/`） | 1回だけ作り、全部の国で使い回す |
| どの行き先を、どの順で出すか | ページの Low Fare Destinations ブロック（UE） | 各国の担当者 |
| 出発地 | ページのパス（国）から自動で決まる | 入力しない |
| 価格 | 運賃 API から自動取得 | 入力しない |

## 1. CF モデル「MH Low Fare Destination」（AEM：p236456-e2388687）

場所：`/conf/global/settings/dam/cfm/models/mh-low-fare-destination`（既存の MH モデルと同じ global 設定）

| フィールド | 名前 | 型 | 入力チェック |
|---|---|---|---|
| Airport Code (IATA) | `airportCode` | 1行テキスト | 必須、`^[A-Z]{3}$`、一意、最大3文字 |
| City Name | `cityName` | 1行テキスト | 必須、最大60文字、翻訳対象 |
| Image (Portrait / Mobile) | `imagePortrait` | コンテンツ参照 | 必須 |
| Image (Landscape / Desktop) | `imageLandscape` | コンテンツ参照 | 任意（無ければ Portrait を使用） |
| Link | `link` | 1行テキスト | 任意、最大255文字 |

CF の置き場所：`/content/dam/hol/lowfare-destinations/`（サンプル10件：Seoul, Osaka, Melbourne, Bangkok, Denpasar Bali, Langkawi, Penang, Sydney, Hong Kong, Kota Kinabalu。写真は `/content/dam/draft/mh/importimage/`）。
ブロックの入力欄でも、このフォルダ以外は選べないようにしています（`validation.rootPath`）。

## 2. CF の読み込み方

| 表示する場所 | 読み込み元 |
|---|---|
| UE（AEM author） | Sites API `/adobe/sites/cf/fragments?path=<フォルダ>`（下書きもすぐ反映） |
| `.aem.page` / `.aem.live` | CF シート `/data/cf/lowfare-destinations.json`（publish 済みの CF から自動生成。`docs/cf-sheets.md`） |

## 3. 出発地はパスで決める（`scripts/market.js`）

1. ページのメタデータ `origin` / `origin-city`（一括メタデータ `/content/eds-ue/metadata` で国ごとに設定）
   | URL | origin | origin-city |
   |---|---|---|
   | /my/** | KUL | Kuala Lumpur |
   | /sg/** | SIN | Singapore |
2. 無ければ、パスに含まれる国コードからコードに書いた既定値（`MARKET_ORIGINS`）を使います。国コードは**何階層目にあっても構いません**（`/my/en/...`、`/hol/my/en/...` → KUL、`/hol/sg/en/...` → SIN）。※ 国ごとの既定空港は MAG に確認してください。
3. `?origin=SIN` は確認用です。localhost、`*.aem.page`、AEM author でだけ有効で、本番（`*.aem.live`、本番ドメイン）では無視されます。

出発地と同じ空港の行き先（例：KUL のページの Kuala Lumpur）は自動で表示しません。

## 4. 価格（入力させない・表示のたびに取得）

価格は**表示のたびに取得**します。いまは外部 API の代わりに、CF「MH Fare」（`/content/dam/hol/fares/`、1路線1件）を **API と同じ形**で返します。

| 項目 | 内容 |
|---|---|
| 呼ぶ URL（既定） | `https://publish-p236456-e2388687.adobeaemcloud.com/graphql/execute.json/global/lowfare-fares;origin=KUL` |
| 返す形式 | `{ data: { mhFareList: { items: [{ origin, destination, price, currency }] } } }` |
| リクエスト数 | 1ページにつき1回（出発地の運賃一覧をまとめて取得） |
| キャッシュ | ブラウザ30秒、CDN 60秒（永続クエリ側の設定）。ブロック側の保持は60秒（メタデータ `low-fare-cache-seconds` で変更でき、`0` で保持しない） |
| UE（author） | 同じクエリを author から読むので、publish 前の運賃も確認できる |

**外部 API への切り替え：** メタデータ `low-fare-api` に URL テンプレートを1行入れるだけです（一括メタデータで `/**` に設定すれば全ページに効きます）。
- `{origin}` だけを含む URL → 出発地の運賃一覧を返す API
- `{destination}` も含む URL → 1路線ずつ返す API
- 受け付ける形式：一覧（`items` / `fares` / `data` の配列。各要素に origin・destination・price・currency。大文字小文字は問わない）、または1件（`{ price, currency }`）

運賃 CF の作り方：CF モデル **MH Fare**（origin・destination：大文字3文字、price：数値、currency：大文字3文字。すべて必須）で作って **publish** します。60秒ほどで表示に反映されます。

## 5. UE での入力チェック

- Title：必須、最大 80 文字。都市名は自動で付くので入力しない旨を説明に表示
- Destination：必須、`/content/dam/eds-ue/destinations` 配下の CF だけ選択可
- 存在しない CF や出発地と同じ空港を選ぶと、**UE の中でだけ**赤い点線のタイルで警告します（公開ページには出しません）
- 最大 15 件
