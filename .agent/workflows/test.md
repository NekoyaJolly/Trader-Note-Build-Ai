---
description: テストを実行する
---

# テスト実行

// turbo
1. 全テストを実行します：
```bash
npm test
```

## 特定ファイルのテスト

特定のファイルだけテストしたい場合：
```bash
npm test -- path/to/file.test.ts
```

## カバレッジ付きテスト

```bash
npm test -- --coverage
```
