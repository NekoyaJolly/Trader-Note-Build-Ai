---
description: 新しい環境でプロジェクトをセットアップする
---

# 初期セットアップ

// turbo-all

1. 依存関係をインストール：
```bash
npm install
```

2. フロントエンドの依存関係をインストール：
```bash
cd src/frontend && npm install && cd ../..
```

3. Prismaクライアントを生成：
```bash
npm run prisma:generate
```

4. データベースマイグレーションを実行：
```bash
npm run prisma:migrate
```

5. セットアップ完了！`/dev` で開発サーバーを起動できます。
