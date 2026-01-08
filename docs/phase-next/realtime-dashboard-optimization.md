# リアルタイムダッシュボード最適化 設計書

> **Phase**: Next  
> **優先度**: 中（コスト検討中）  
> **作成日**: 2026-01-08

---

## 1. 現状分析

### 1.1 既存のデータソース

| ソース | 方式 | コスト | リアルタイム性 | 制限 |
|--------|------|--------|---------------|------|
| **Twelve Data** | REST API | 無料 | 遅延あり | 8 req/分, 800 req/日 |
| **Twelve Data WS** | WebSocket | 有料 | リアルタイム | 月額 $29〜 |
| **cTrader** | WebSocket | 無料 | リアルタイム | 認証必須 |

### 1.2 現在の実装状況

```
cTrader WebSocket → RollingWindowService → Tick集約
     ↓
RealtimeSimilarityService → 類似度チェック
     ↓
StrategyAlert → 条件成立判定
     ↓
PushSubscription → Web Push 通知
```

**課題:**
- cTrader WebSocket は認証済みユーザーのみ利用可能
- Twelve Data 無料プランではリアルタイム更新が困難
- ダッシュボード全体の価格更新には API 制限が厳しい

---

## 2. コスト効率の良いアプローチ

### 2.1 ハイブリッド戦略

```
┌─────────────────────────────────────────────────────────────────┐
│                    リアルタイム性 vs コスト                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [リアルタイム]     [準リアルタイム]      [定期更新]            │
│   cTrader WS         スマートポーリング    バッチ               │
│   (無料・認証済)     (API制限内)          (1日1回)             │
│                                                                 │
│  ┌─────────┐      ┌─────────────┐      ┌──────────┐           │
│  │監視中の │      │ダッシュボード│      │履歴データ│           │
│  │アラート │      │全体表示     │      │バックテスト│          │
│  └─────────┘      └─────────────┘      └──────────┘           │
│                                                                 │
│  コスト: 0         コスト: 低           コスト: 最低           │
│  遅延: <1秒        遅延: 15-60秒        遅延: 数時間           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 スマートポーリング

#### 市場時間帯に応じた動的間隔

```typescript
/**
 * 市場時間帯に応じてポーリング間隔を動的に調整
 * 
 * 目的: API 制限内でユーザー体験を最大化
 */
const MARKET_HOURS = {
  // 東京市場 (UTC+9)
  tokyo: { open: 0, close: 6 },  // 9:00-15:00 JST = 0:00-6:00 UTC
  // ロンドン市場 (UTC+0/+1)
  london: { open: 7, close: 15 }, // 8:00-16:00 GMT
  // NY市場 (UTC-5/-4)
  ny: { open: 13, close: 21 },    // 9:30-16:00 EST
};

interface PollingConfig {
  interval: number;        // ミリ秒
  maxSymbols: number;      // 同時更新シンボル数
  priority: 'high' | 'normal' | 'low';
}

function getPollingConfig(utcHour: number, dayOfWeek: number): PollingConfig {
  // 週末
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { interval: 3600_000, maxSymbols: 1, priority: 'low' };  // 1時間
  }
  
  // 市場活発時間帯を判定
  const isTokyoActive = utcHour >= 0 && utcHour < 6;
  const isLondonActive = utcHour >= 7 && utcHour < 15;
  const isNYActive = utcHour >= 13 && utcHour < 21;
  
  // 複数市場オーバーラップ（最も活発）
  if ((isLondonActive && isNYActive) || (isTokyoActive && isLondonActive)) {
    return { interval: 15_000, maxSymbols: 3, priority: 'high' };  // 15秒
  }
  
  // 単一市場アクティブ
  if (isTokyoActive || isLondonActive || isNYActive) {
    return { interval: 30_000, maxSymbols: 2, priority: 'normal' };  // 30秒
  }
  
  // 市場閑散時
  return { interval: 300_000, maxSymbols: 1, priority: 'low' };  // 5分
}
```

#### API 使用量最適化

```typescript
/**
 * 日次 API 使用量を追跡し、制限内に収める
 */
class APIUsageTracker {
  private dailyLimit = 800;
  private minuteLimit = 8;
  private dailyUsage = 0;
  private minuteUsage = 0;
  private lastMinuteReset = Date.now();
  
  canMakeRequest(): boolean {
    this.resetMinuteIfNeeded();
    return this.dailyUsage < this.dailyLimit && this.minuteUsage < this.minuteLimit;
  }
  
  recordRequest(): void {
    this.dailyUsage++;
    this.minuteUsage++;
  }
  
  private resetMinuteIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastMinuteReset >= 60_000) {
      this.minuteUsage = 0;
      this.lastMinuteReset = now;
    }
  }
  
  getRemainingDaily(): number {
    return this.dailyLimit - this.dailyUsage;
  }
  
  // 日次リセット（UTC 0:00）
  resetDaily(): void {
    this.dailyUsage = 0;
  }
}
```

### 2.3 ユーザー操作トリガー

```typescript
/**
 * ダッシュボード表示中のみ更新
 * 画面非表示時は停止してAPI節約
 */
class VisibilityAwarePoller {
  private intervalId: NodeJS.Timeout | null = null;
  private isVisible = true;
  
  constructor(private fetchFn: () => Promise<void>, private interval: number) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }
  
  private handleVisibilityChange = () => {
    this.isVisible = !document.hidden;
    
    if (this.isVisible) {
      this.start();
    } else {
      this.stop();
    }
  };
  
  start(): void {
    if (this.intervalId) return;
    
    // 即座に1回実行
    this.fetchFn();
    
    this.intervalId = setInterval(() => {
      if (this.isVisible) {
        this.fetchFn();
      }
    }, this.interval);
  }
  
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  destroy(): void {
    this.stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }
}
```

### 2.4 Server-Sent Events (SSE)

```typescript
/**
 * SSE によるサーバープッシュ
 * 
 * メリット:
 * - WebSocket より軽量
 * - HTTP/2 対応
 * - ファイアウォールフレンドリー
 * - 自動再接続
 */

// バックエンド
app.get('/api/realtime/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // クライアントが監視するシンボルを取得
  const symbols = (req.query.symbols as string)?.split(',') || ['USDJPY'];
  
  const sendUpdate = async () => {
    try {
      const data = await getLatestPrices(symbols);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'fetch failed' })}\n\n`);
    }
  };
  
  // 初回送信
  sendUpdate();
  
  // 定期送信（30秒ごと）
  const interval = setInterval(sendUpdate, 30_000);
  
  // クライアント切断時
  req.on('close', () => {
    clearInterval(interval);
  });
});

// フロントエンド
function useRealtimePrices(symbols: string[]) {
  const [prices, setPrices] = useState<PriceData[]>([]);
  
  useEffect(() => {
    const symbolsParam = symbols.join(',');
    const eventSource = new EventSource(`/api/realtime/stream?symbols=${symbolsParam}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setPrices(data);
    };
    
    eventSource.onerror = () => {
      // 自動再接続（EventSource の標準動作）
      console.log('SSE 接続エラー、再接続中...');
    };
    
    return () => eventSource.close();
  }, [symbols]);
  
  return prices;
}
```

### 2.5 キャッシュ戦略

```typescript
/**
 * 多層キャッシュでAPI呼び出しを最小化
 */

// 1. メモリキャッシュ（最速）
const memoryCache = new Map<string, { data: PriceData; timestamp: number }>();
const MEMORY_TTL = 10_000;  // 10秒

// 2. Redis キャッシュ（共有）
// 複数サーバー間でキャッシュを共有
const REDIS_TTL = 30;  // 30秒

// 3. DB キャッシュ（永続）
// OHLCVCandle テーブル

async function getPrice(symbol: string): Promise<PriceData> {
  // 1. メモリキャッシュをチェック
  const cached = memoryCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < MEMORY_TTL) {
    return cached.data;
  }
  
  // 2. Redis をチェック（将来実装）
  // const redisData = await redis.get(`price:${symbol}`);
  // if (redisData) return JSON.parse(redisData);
  
  // 3. DB から最新を取得
  const dbData = await prisma.oHLCVCandle.findFirst({
    where: { symbol },
    orderBy: { timestamp: 'desc' },
  });
  
  if (dbData) {
    const priceData = {
      symbol,
      price: Number(dbData.close),
      timestamp: dbData.timestamp,
    };
    
    // メモリキャッシュに保存
    memoryCache.set(symbol, { data: priceData, timestamp: Date.now() });
    
    return priceData;
  }
  
  // 4. API から取得（最終手段）
  const apiData = await fetchFromAPI(symbol);
  memoryCache.set(symbol, { data: apiData, timestamp: Date.now() });
  
  return apiData;
}
```

---

## 3. 推奨実装プラン

### 3.1 フェーズ分け

| フェーズ | 内容 | コスト | 効果 |
|---------|------|--------|------|
| **Phase 1** | スマートポーリング | 0 | 中 |
| **Phase 2** | SSE 実装 | 0 | 高 |
| **Phase 3** | キャッシュ最適化 | 0 | 高 |
| **Phase 4** | Redis 導入（オプション） | 低 | 中 |
| **Phase 5** | 有料API（オプション） | 高 | 最高 |

### 3.2 コスト比較

| プラン | 月額コスト | リアルタイム性 | 推奨用途 |
|--------|-----------|---------------|---------|
| **現状維持** | ¥0 | 30秒〜5分遅延 | 個人利用 |
| **スマートポーリング** | ¥0 | 15秒〜30秒遅延 | 個人〜小規模 |
| **SSE + キャッシュ** | ¥0 | 15秒〜30秒遅延 | 小〜中規模 |
| **Twelve Data Basic** | 約¥4,000 | 数秒遅延 | 中規模 |
| **Twelve Data Pro** | 約¥12,000 | リアルタイム | 本格運用 |

---

## 4. UI設計

### 4.1 ダッシュボード

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 マーケットダッシュボード              最終更新: 10秒前 🔄  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ USDJPY          │  │ EURUSD          │  │ XAUUSD          │ │
│  │ 156.234 ▲ +0.12%│  │ 1.0856 ▼ -0.08%│  │ 2,645.30 ▲ +0.5%│ │
│  │ ━━━━━━━━━━━━━━━ │  │ ━━━━━━━━━━━━━━━ │  │ ━━━━━━━━━━━━━━━ │ │
│  │ H: 156.45       │  │ H: 1.0878       │  │ H: 2,658.00     │ │
│  │ L: 155.98       │  │ L: 1.0842       │  │ L: 2,632.50     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  🔔 アラート発火履歴                                     │   │
│  │                                                           │   │
│  │  15:32  USDJPY  RSI逆張り  スコア: 0.87  ✓ 条件成立      │   │
│  │  14:45  EURUSD  ブレイクアウト  スコア: 0.72  ✗ 未達    │   │
│  │  13:20  XAUUSD  トレンドフォロー  スコア: 0.91  ✓ 条件成立│   │
│  │                                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  📈 市場状況                                              │   │
│  │                                                           │   │
│  │  東京市場: 🟢 オープン  |  ロンドン: 🔴 クローズ         │   │
│  │  NY市場: 🔴 クローズ    |  次の市場オープン: 16:00 JST   │   │
│  │                                                           │   │
│  │  更新頻度: 30秒（市場活発時は15秒）                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 更新状態インジケーター

```typescript
/**
 * 更新状態を視覚的に表示
 */
function UpdateIndicator({ lastUpdate }: { lastUpdate: Date }) {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - lastUpdate.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdate]);
  
  const getStatusColor = () => {
    if (elapsed < 15) return 'text-green-500';   // 新鮮
    if (elapsed < 60) return 'text-yellow-500';  // やや古い
    return 'text-red-500';                        // 古い
  };
  
  return (
    <span className={getStatusColor()}>
      {elapsed < 60 ? `${elapsed}秒前` : `${Math.floor(elapsed / 60)}分前`}
    </span>
  );
}
```

---

## 5. 決定事項（ユーザー確認待ち）

### 質問

1. **優先度**: スマートポーリング + SSE の実装を先に進めますか？
2. **対象シンボル**: 同時監視するシンボル数の上限は？（推奨: 5〜10）
3. **将来的な有料API**: Twelve Data Pro への移行は検討していますか？

### 推奨

**Phase 1（スマートポーリング）+ Phase 2（SSE）** を先に実装することで、
追加コストなしでユーザー体験を大幅に改善できます。

必要に応じて Phase 4（Redis）や Phase 5（有料API）を追加検討してください。

