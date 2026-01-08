---
description: Prismaクライアントエラー時の再生成
---

# Prisma再生成

// turbo-all

1. Prismaクライアントを再生成：
```bash
npm run prisma:generate
```

2. もしまだエラーが続く場合：
```bash
npx prisma generate --schema=./prisma/schema.prisma
```

3. 完了！
