/**
 * Side-B モデル（型定義・バリデーション）のテスト
 */

import {
  validateFeatureVector,
  validateResearchAIOutput,
  validatePlanAIOutput,
  calculateExpiryDate,
  isResearchValid,
  regimeToJapanese,
  confidenceToJapanese,
  directionToJapanese,
  createEmptyFeatureVector,
  featureVectorToArray,
  calculateCosineSimilarity,
  FeatureVector12D,
  MarketResearch,
} from '../models';

describe('Side-B Models', () => {
  // ===========================================
  // FeatureVector バリデーション
  // ===========================================
  describe('validateFeatureVector', () => {
    it('正常な12次元特徴量を受け入れる', () => {
      const validVector = {
        trendStrength: 70,
        trendDirection: 80,
        maAlignment: 60,
        pricePosition: 55,
        rsiLevel: 65,
        macdMomentum: 50,
        momentumDivergence: 20,
        volatilityLevel: 45,
        bbWidth: 40,
        volatilityTrend: 55,
        supportProximity: 30,
        resistanceProximity: 70,
      };

      const result = validateFeatureVector(validVector);
      expect(result).toEqual(validVector);
    });

    it('必須フィールドが欠けている場合エラー', () => {
      const invalidVector = {
        trendStrength: 70,
        // trendDirection が欠けている
        maAlignment: 60,
      };

      expect(() => validateFeatureVector(invalidVector)).toThrow();
    });

    it('範囲外の値（負の数）はエラー', () => {
      const vectorWithNegative = {
        trendStrength: -10,  // 範囲外
        trendDirection: 80,
        maAlignment: 60,
        pricePosition: 55,
        rsiLevel: 65,
        macdMomentum: 50,
        momentumDivergence: 20,
        volatilityLevel: 45,
        bbWidth: 40,
        volatilityTrend: 55,
        supportProximity: 30,
        resistanceProximity: 70,
      };

      // バリデーションはエラーを投げる（クランプではない）
      expect(() => validateFeatureVector(vectorWithNegative)).toThrow('Invalid trendStrength');
    });

    it('範囲外の値（100超）はエラー', () => {
      const vectorWithOver100 = {
        trendStrength: 150,  // 範囲外
        trendDirection: 80,
        maAlignment: 60,
        pricePosition: 55,
        rsiLevel: 65,
        macdMomentum: 50,
        momentumDivergence: 20,
        volatilityLevel: 45,
        bbWidth: 40,
        volatilityTrend: 55,
        supportProximity: 30,
        resistanceProximity: 70,
      };

      // バリデーションはエラーを投げる（クランプではない）
      expect(() => validateFeatureVector(vectorWithOver100)).toThrow('Invalid trendStrength');
    });
  });

  // ===========================================
  // Research AI 出力バリデーション
  // ===========================================
  describe('validateResearchAIOutput', () => {
    it('正常な出力を受け入れる（シンプル化: featureVectorのみ）', () => {
      const validOutput = {
        featureVector: {
          trendStrength: 70,
          trendDirection: 80,
          maAlignment: 60,
          pricePosition: 55,
          rsiLevel: 65,
          macdMomentum: 50,
          momentumDivergence: 20,
          volatilityLevel: 45,
          bbWidth: 40,
          volatilityTrend: 55,
          supportProximity: 30,
          resistanceProximity: 70,
        },
      };

      const result = validateResearchAIOutput(validOutput);
      expect(result.featureVector).toBeDefined();
      expect(result.featureVector.trendStrength).toBe(70);
    });

    it('featureVectorがない場合エラー', () => {
      const invalidOutput = {};

      expect(() => validateResearchAIOutput(invalidOutput)).toThrow('featureVector is required');
    });
  });

  // ===========================================
  // Plan AI 出力バリデーション
  // ===========================================
  describe('validatePlanAIOutput', () => {
    const validPlanOutput = {
      marketAnalysis: {
        regime: 'uptrend',
        regimeConfidence: 80,
        trendDirection: 'up',
        volatility: 'medium',
        keyLevels: {
          support: [100],
          resistance: [110],
          strongSupport: [],
          strongResistance: [],
        },
        summary: 'テストサマリー',
      },
      scenarios: [
        {
          name: 'テストシナリオ',
          direction: 'long',
          priority: 'primary',
          entry: { type: 'limit', price: 100, condition: 'テスト', triggerIndicators: [] },
          stopLoss: { price: 95, pips: 50, reason: 'テスト' },
          takeProfit: { price: 110, pips: 100, reason: 'テスト' },
          riskReward: 2,
          confidence: 80,
          rationale: 'テスト理由',
          invalidationConditions: [],
        },
      ],
      overallConfidence: 80,
      warnings: [],
    };

    it('正常な出力を受け入れる', () => {
      const result = validatePlanAIOutput(validPlanOutput);
      expect(result.marketAnalysis.regime).toBe('uptrend');
      expect(result.scenarios).toHaveLength(1);
    });

    it('無効なレジームはエラー', () => {
      const invalidOutput = {
        ...validPlanOutput,
        marketAnalysis: {
          ...validPlanOutput.marketAnalysis,
          regime: 'invalid_regime',
        },
      };

      expect(() => validatePlanAIOutput(invalidOutput)).toThrow('Invalid regime');
    });

    it('シナリオが0個はエラー', () => {
      const invalidOutput = {
        ...validPlanOutput,
        scenarios: [],
      };

      expect(() => validatePlanAIOutput(invalidOutput)).toThrow('scenarios must have 1-3 items');
    });

    it('シナリオが4個以上はエラー', () => {
      const scenario = validPlanOutput.scenarios[0];
      const invalidOutput = {
        ...validPlanOutput,
        scenarios: [scenario, scenario, scenario, scenario],
      };

      expect(() => validatePlanAIOutput(invalidOutput)).toThrow('scenarios must have 1-3 items');
    });

    it('overallConfidenceが範囲外はエラー', () => {
      const invalidOutput = {
        ...validPlanOutput,
        overallConfidence: 150,
      };

      expect(() => validatePlanAIOutput(invalidOutput)).toThrow('overallConfidence must be number 0-100');
    });
  });

  // ===========================================
  // ユーティリティ関数
  // ===========================================
  describe('calculateExpiryDate', () => {
    it('デフォルトで4時間後を返す', () => {
      const now = new Date();
      const expiry = calculateExpiryDate();
      
      const diff = expiry.getTime() - now.getTime();
      const hours = diff / (1000 * 60 * 60);
      
      // 4時間前後であることを確認（実行時間の誤差を許容）
      expect(hours).toBeGreaterThan(3.9);
      expect(hours).toBeLessThan(4.1);
    });

    it('指定時間後を返す', () => {
      const now = new Date();
      const expiry = calculateExpiryDate(2);
      
      const diff = expiry.getTime() - now.getTime();
      const hours = diff / (1000 * 60 * 60);
      
      expect(hours).toBeGreaterThan(1.9);
      expect(hours).toBeLessThan(2.1);
    });
  });

  describe('isResearchValid', () => {
    it('有効期限内ならtrue', () => {
      const research = {
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),  // 1時間後
      } as MarketResearch;

      expect(isResearchValid(research)).toBe(true);
    });

    it('有効期限切れならfalse', () => {
      const research = {
        expiresAt: new Date(Date.now() - 1000 * 60 * 60),  // 1時間前
      } as MarketResearch;

      expect(isResearchValid(research)).toBe(false);
    });
  });

  describe('regimeToJapanese', () => {
    it('各レジームを日本語に変換', () => {
      expect(regimeToJapanese('uptrend')).toBe('上昇トレンド');
      expect(regimeToJapanese('downtrend')).toBe('下降トレンド');
      expect(regimeToJapanese('range')).toBe('レンジ相場');
      expect(regimeToJapanese('volatile')).toBe('高ボラティリティ');
    });
  });

  describe('confidenceToJapanese', () => {
    it('信頼度を日本語に変換', () => {
      expect(confidenceToJapanese(95)).toBe('非常に高い');
      expect(confidenceToJapanese(75)).toBe('高い');
      expect(confidenceToJapanese(55)).toBe('中程度');
      expect(confidenceToJapanese(35)).toBe('低い');
      expect(confidenceToJapanese(20)).toBe('非常に低い');
    });
  });

  describe('directionToJapanese', () => {
    it('方向を日本語に変換', () => {
      expect(directionToJapanese('long')).toBe('ロング');
      expect(directionToJapanese('short')).toBe('ショート');
    });
  });

  // ===========================================
  // 特徴量ベクトル操作
  // ===========================================
  describe('createEmptyFeatureVector', () => {
    it('すべて50の特徴量を作成', () => {
      const empty = createEmptyFeatureVector();
      
      expect(empty.trendStrength).toBe(50);
      expect(empty.trendDirection).toBe(50);
      expect(empty.rsiLevel).toBe(50);
    });
  });

  describe('featureVectorToArray', () => {
    it('特徴量を配列に変換', () => {
      const vector: FeatureVector12D = {
        trendStrength: 70,
        trendDirection: 80,
        maAlignment: 60,
        pricePosition: 55,
        rsiLevel: 65,
        macdMomentum: 50,
        momentumDivergence: 20,
        volatilityLevel: 45,
        bbWidth: 40,
        volatilityTrend: 55,
        supportProximity: 30,
        resistanceProximity: 70,
      };

      const arr = featureVectorToArray(vector);
      expect(arr).toHaveLength(12);
      expect(arr[0]).toBe(70);  // trendStrength
    });
  });

  describe('calculateCosineSimilarity', () => {
    it('同一ベクトルは類似度1.0', () => {
      const vector: FeatureVector12D = {
        trendStrength: 70,
        trendDirection: 80,
        maAlignment: 60,
        pricePosition: 55,
        rsiLevel: 65,
        macdMomentum: 50,
        momentumDivergence: 20,
        volatilityLevel: 45,
        bbWidth: 40,
        volatilityTrend: 55,
        supportProximity: 30,
        resistanceProximity: 70,
      };

      const similarity = calculateCosineSimilarity(vector, vector);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('異なるベクトルは類似度1.0未満', () => {
      const vector1: FeatureVector12D = createEmptyFeatureVector();
      const vector2: FeatureVector12D = {
        ...createEmptyFeatureVector(),
        trendStrength: 100,
        trendDirection: 100,
      };

      const similarity = calculateCosineSimilarity(vector1, vector2);
      expect(similarity).toBeLessThan(1.0);
      expect(similarity).toBeGreaterThan(0);
    });
  });
});
