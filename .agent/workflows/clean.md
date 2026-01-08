---
description: キャッシュをクリアして再起動
---

# キャッシュクリア

// turbo-all

1. Frontendのキャッシュをクリア：
```bash
rm -rf src/frontend/.next
```

2. node_modulesを再インストール（時間がかかります）：
```bash
rm -rf node_modules && npm install
```

3. Frontendのnode_modulesも再インストール：
```bash
cd src/frontend && rm -rf node_modules && npm install && cd ../..
```

4. 完了！`/dev` で再起動できます。
