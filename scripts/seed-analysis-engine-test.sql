-- analysis-engine の /by-version 検証用の最小シード
-- 注意: ローカル検証用。重複投入は ON CONFLICT で回避。

-- 1) OHLCV（24本）
INSERT INTO "OHLCVCandle"(id, symbol, timeframe, timestamp, open, high, low, close, volume)
SELECT
  gen_random_uuid(),
  'USDJPY',
  '1h',
  ts,
  150.0000,
  151.0000,
  149.0000,
  150.5000,
  1000.0000
FROM generate_series(
  '2026-01-01T00:00:00Z'::timestamptz,
  '2026-01-01T23:00:00Z'::timestamptz,
  interval '1 hour'
) AS ts
ON CONFLICT (symbol, timeframe, timestamp) DO NOTHING;

-- 2) Strategy + StrategyVersion（entryConditions に RSI を含める）
WITH s AS (
  INSERT INTO "Strategy"(id, name, description, symbol, side, status, tags, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid(),
    '検証用戦略',
    'analysis-engine by-version 検証',
    'USDJPY',
    'buy',
    'draft',
    ARRAY[]::text[],
    now(),
    now()
  )
  RETURNING id
),
v AS (
  INSERT INTO "StrategyVersion"(
    id,
    "strategyId",
    "versionNumber",
    symbol,
    side,
    "entryConditions",
    "exitSettings",
    "entryTiming",
    "changeNote",
    "createdAt"
  )
  SELECT
    gen_random_uuid(),
    s.id,
    1,
    'USDJPY',
    'buy',
    '{
      "groupId": "g1",
      "operator": "AND",
      "conditions": [
        {
          "conditionId": "c1",
          "indicatorId": "rsi",
          "params": { "period": 14 },
          "field": "value",
          "operator": "<",
          "compareTarget": { "type": "fixed", "value": 30 }
        }
      ]
    }'::jsonb,
    '{
      "takeProfit": { "value": 10, "unit": "pips" },
      "stopLoss": { "value": 10, "unit": "pips" }
    }'::jsonb,
    'next_open',
    '検証用',
    now()
  FROM s
  RETURNING id, "strategyId"
)
,
u AS (
  UPDATE "Strategy" st
  SET "currentVersionId" = v.id
  FROM v
  WHERE st.id = v."strategyId"
  RETURNING st.id AS "strategyId", st."currentVersionId" AS "versionId"
)

-- 3) 作成したIDを返す
SELECT * FROM u;
