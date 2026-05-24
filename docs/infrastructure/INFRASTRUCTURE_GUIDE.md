# GCP (Cloud Run) × Supabase (PostgreSQL) 本番接続構成ガイド

GCP にデプロイされたバックエンド API (Cloud Run) から、別クラウドにある Supabase (PostgreSQL) に安全かつ高可用に接続するための本番用インフラ構成手順です。

---

## 1. 接続制限とセキュリティ (IP固定によるアクセス制限)

Supabase データベースポートをグローバルに開放せず、GCP からの接続のみを許可する設定を行います。
Cloud Run は動的IPであるため、送信トラフィックのIPアドレスを固定する設定が必要です。

### GCP 側の構成手順

1. **Serverless VPC Access コネクタの作成**
   * GCPコンソールで「Serverless VPC Access」に移動し、`Create Connector` をクリックします。
   * **Name**: `cloudrun-supabase-connector` 等
   * **Region**: Cloud Run と同じリージョン（例: `asia-northeast1`）
   * **Network**: デフォルトの VPC ネットワークを選択
   * **Subnet / IP Range**: 空いている `/28` のIP帯（例: `10.8.0.0/28`）を指定します。

2. **Cloud NAT の作成**
   * GCPコンソールで「Cloud NAT」に移動し、`Get Started` をクリックします。
   * **NAT gateway name**: `supabase-nat-gateway` 等
   * **Network**: コネクタと同じ VPC ネットワーク
   * **Region**: コネクタと同じリージョン
   * **Cloud Router**: 新規作成（例: `router-supabase`）
   * **NAT IP addresses**: `Manual` を選択し、新規の静的IPアドレス（例: `Static-IP-Supabase`）を予約・アタッチします。

3. **Cloud Run へのアタッチとルーティング設定**
   * Cloud Run サービスの編集（新しいリビジョンの作成）画面を開きます。
   * 「接続 (Connections)」タブに移動し、**VPC Network** セクションで「すべての送信トラフィックをVPC経由でルーティングする (Route all traffic through the VPC)」を選択します。
   * 作成した Serverless VPC Access コネクタ (`cloudrun-supabase-connector`) を選択します。
   * これにより、Cloud Run の外へ向かうすべてのトラフィック（Supabase への接続含む）が Cloud NAT の静的IPアドレスから発信されるようになります。

### Supabase 側の構成手順

1. **Network Restrictions の設定**
   * Supabaseコンソールでプロジェクトの `Database Settings` ＞ `Network Restrictions` に移動します。
   * GCP 側で作成した **Cloud NAT の静的外部IPアドレス**（例: `35.x.x.x/32`）のみを接続許可リスト（Allowlist）に登録します。
   * これにより、登録されたGCPのIPアドレス以外からの直接接続がすべて遮断されます。

---

## 2. 接続プール（Connection Pooler）の設定

Cloud Run はサーバーレス環境であり、負荷増大時にインスタンスが自動スケールし、データベース接続が急増して最大接続数（Max Connections）に達しやすくなります。
これを防ぐため、Supabase のトランザクションプール（PgBouncer / Supavisor）を利用します。

### 環境変数設定

#### `DATABASE_URL` (トランザクションプール用 / アプリ実行用)
* ポート `6543` (PgBouncer のプール用ポート) を使用します。
* パラメータ `?pgbouncer=true&connection_limit=3` を付与します（コネクションプールに各インスタンスが保持する接続上限を絞るため）。
```ini
DATABASE_URL="postgresql://postgres.[ProjectRef]:[Password]@aws-0-asia-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=3"
```

#### `DIRECT_URL` (直接接続用 / マイグレーション用)
* ポート `5432` (PostgreSQL の直接接続用ポート) を使用します。
* この接続は `npx prisma db push` や `prisma migrate` などの接続プールを経由できない操作の実行時のみ使用されます。
```ini
DIRECT_URL="postgresql://postgres.[ProjectRef]:[Password]@db.[ProjectRef].supabase.co:5432/postgres"
```

---

## 3. リソースの監視とクリーンアップ

Supabase 無料枠などのディスク容量制限（500MBなど）への対策として、API はデータベースサイズを監視しています。

1. **容量警告と通知**
   * システムヘルスAPI `/api/side-b/system/health` は、内部で `pg_database_size(current_database())` クエリを使用してデータベース容量を監視しています。
   * 総容量が `400MB`（80%）を超えると、ダッシュボード上に警告アイコンが表示され、管理者に警告メールが送信されます（メール送信は過剰送信を防ぐため24時間に1回に制限されます）。
2. **データのクリーンアップ**
   * `SIDE_B_SCHEDULER_ENABLED` ジョブ内の自動クリーンアップ（`autoCleanup=true`）により、古いデータ（90日以上前の VirtualTrade や古い EvaluationLog など）は `cleanupJob.ts` によって定期的に削除されます。
   * 容量警告が消えない場合は、管理画面より手動で古いデータのクリーンアップ処理を実行してください。
