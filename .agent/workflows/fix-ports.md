---
description: ポートが使用中のときに解放する
---

# ポート解放

// turbo-all

1. 使用中のポートを停止：
```bash
npm run kill:ports
```

2. もし上記が動かない場合、手動で解放：
```bash
lsof -ti :3100 | xargs kill -9 2>/dev/null || true
lsof -ti :3102 | xargs kill -9 2>/dev/null || true
```

3. ポートが解放されました！再度 `/dev` で起動できます。
