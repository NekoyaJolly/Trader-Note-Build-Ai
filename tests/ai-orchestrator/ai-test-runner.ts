import { chromium, Page, Browser, BrowserContext } from 'playwright';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';

/**
 * AIテストオーケストレーター
 * 目的: GPT-4を使用してUIを解析し、自動的にテストシナリオを生成・実行
 * 注意: OpenAI APIを使用するため課金が発生します
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface TestScenario {
  name: string;
  description: string;
  steps: string[];
  expectedResults: string[];
}

interface TestResult {
  scenario: string;
  status: 'PASS' | 'FAIL';
  steps: {
    step: string;
    action: string;
    result: 'PASS' | 'FAIL';
    screenshot?: string;
    error?: string;
  }[];
  duration: number;
}

export class AITestOrchestrator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private testResults: TestResult[] = [];

  async initialize() {
    console.log('🚀 AIテストオーケストレーター起動中...');
    
    this.browser = await chromium.launch({ 
      headless: process.env.HEADLESS !== 'false',
      slowMo: 500 // 動作を見やすくする
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { 
        dir: './test-videos/',
        size: { width: 1920, height: 1080 }
      }
    });
    
    this.page = await this.context.newPage();
    
    // コンソールログをキャプチャ
    this.page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    this.page.on('pageerror', err => console.error(`[Browser Error] ${err.message}`));
    
    console.log('✅ 初期化完了');
  }

  /**
   * AIにテストシナリオを生成させる
   */
  async generateTestScenarios(feature: string): Promise<TestScenario[]> {
    console.log(`\n🤖 AIがテストシナリオを生成中: ${feature}`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{
        role: "system",
        content: `あなたはTradeAssist（取引ノート管理システム）の専門QAエンジニアです。

TradeAssistの主要機能:
- トレード履歴からの自動トレードノート生成
- リアルタイム市場データとの一致判定
- 通知 + 発注支援UI
- チャート表示（lightweight-charts）
- RSI, SMAなどのテクニカル指標

タスク: "${feature}" の包括的なテストシナリオを生成してください。

出力形式（JSON）:
{
  "testScenarios": [
    {
      "name": "シナリオ名",
      "description": "説明",
      "steps": ["ステップ1", "ステップ2", ...],
      "expectedResults": ["期待結果1", "期待結果2", ...]
    }
  ]
}

注意事項:
- 日本語で記述
- 各ステップは明確で実行可能な指示
- 期待結果は検証可能な内容
- エッジケースも含める`
      }],
      response_format: { type: "json_object" },
      temperature: 0.7
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error('AIからのレスポンスが空です');
    
    const scenarios = JSON.parse(content);
    console.log(`✅ ${scenarios.testScenarios.length}件のシナリオを生成しました`);
    
    // 生成したシナリオを保存
    await fs.writeFile(
      path.join(__dirname, 'test-scenarios.json'),
      JSON.stringify(scenarios, null, 2),
      'utf-8'
    );
    
    return scenarios.testScenarios || [];
  }

  /**
   * AIがUI画面を解析して次のアクションを決定
   */
  async analyzeUIAndDecideAction(instruction: string): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');

    console.log(`  🔍 UI解析中: ${instruction}`);

    // スクリーンショット取得
    const screenshot = await this.page.screenshot();
    const base64Image = screenshot.toString('base64');

    // HTMLソースも取得
    const bodyText = await this.page.locator('body').textContent() || '';

    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [{
        role: "user",
        content: [
          { 
            type: "text", 
            text: `現在のUI画面を見て、次の指示を実行するためのPlaywrightコマンドを生成してください。

指示: ${instruction}

画面のテキスト内容:
${bodyText.substring(0, 500)}...

要件:
- Playwrightのコマンドのみを返す（説明不要）
- 複数コマンドが必要な場合は改行で区切る
- セレクタは data-testid を優先、なければ適切なCSSセレクタを使用
- page. で始まるコマンド形式

例:
await page.click('button[data-testid="submit"]');
await page.fill('input[name="email"]', 'test@example.com');
await page.waitForSelector('[data-testid="dashboard"]');` 
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64Image}` }
          }
        ]
      }],
      max_tokens: 500,
      temperature: 0.3
    });

    const command = response.choices[0].message.content || '';
    console.log(`  💡 生成されたコマンド:\n${command}`);
    
    return command;
  }

  /**
   * AIがテスト結果を検証
   */
  async verifyResult(expectedResult: string): Promise<{ isValid: boolean; reasoning: string }> {
    if (!this.page) throw new Error('Page not initialized');

    console.log(`  ✓ 検証中: ${expectedResult}`);

    const screenshot = await this.page.screenshot();
    const base64Image = screenshot.toString('base64');
    const bodyText = await this.page.locator('body').textContent() || '';

    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [{
        role: "user",
        content: [
          { 
            type: "text", 
            text: `この画面は次の期待結果を満たしていますか？

期待結果: ${expectedResult}

画面のテキスト内容:
${bodyText.substring(0, 500)}...

JSON形式で回答してください:
{
  "isValid": true/false,
  "reasoning": "判断理由（日本語）"
}` 
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64Image}` }
          }
        ]
      }],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0.2
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    console.log(`  ${result.isValid ? '✅' : '❌'} ${result.reasoning}`);
    
    return result;
  }

  /**
   * シナリオ実行
   */
  async runScenario(scenario: TestScenario): Promise<TestResult> {
    console.log(`\n🧪 テスト実行: ${scenario.name}`);
    console.log(`   ${scenario.description}`);
    
    const startTime = Date.now();
    const result: TestResult = {
      scenario: scenario.name,
      status: 'PASS',
      steps: [],
      duration: 0
    };

    try {
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const expectedResult = scenario.expectedResults[i];

        console.log(`\n  ステップ ${i + 1}/${scenario.steps.length}: ${step}`);
        
        try {
          // AIにアクションを決定させる
          const playwrightCommands = await this.analyzeUIAndDecideAction(step);
          
          // コマンドを実行
          const commands = playwrightCommands.split('\n').filter(cmd => cmd.trim());
          
          for (const cmd of commands) {
            const cleanCmd = cmd.replace(/^await\s+/, '').trim();
            if (cleanCmd.startsWith('page.')) {
              // 安全な実行（evalの代わりにFunction使用）
              const func = new Function('page', `return ${cleanCmd}`);
              await func(this.page);
              await this.page!.waitForTimeout(1000); // 画面安定待ち
            }
          }

          // スクリーンショット保存
          const screenshotPath = `./playwright-report/screenshots/step-${i + 1}.png`;
          await this.page!.screenshot({ path: screenshotPath });

          // 結果検証
          const verification = await this.verifyResult(expectedResult);
          
          result.steps.push({
            step,
            action: playwrightCommands,
            result: verification.isValid ? 'PASS' : 'FAIL',
            screenshot: screenshotPath
          });

          if (!verification.isValid) {
            result.status = 'FAIL';
            throw new Error(`期待結果が満たされませんでした: ${verification.reasoning}`);
          }

        } catch (error) {
          console.error(`  ❌ エラー: ${error}`);
          result.steps.push({
            step,
            action: '',
            result: 'FAIL',
            error: String(error)
          });
          result.status = 'FAIL';
          throw error;
        }
      }

      console.log(`\n✅ ${scenario.name} 完了`);
      
    } catch (error) {
      console.error(`\n❌ ${scenario.name} 失敗`);
    } finally {
      result.duration = Date.now() - startTime;
      this.testResults.push(result);
    }

    return result;
  }

  /**
   * レポート生成
   */
  async generateReport(): Promise<void> {
    const reportPath = './playwright-report/ai-test-report.json';
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.testResults.length,
        passed: this.testResults.filter(r => r.status === 'PASS').length,
        failed: this.testResults.filter(r => r.status === 'FAIL').length,
        totalDuration: this.testResults.reduce((sum, r) => sum + r.duration, 0)
      },
      results: this.testResults
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    
    console.log(`\n📊 テストレポート生成完了: ${reportPath}`);
    console.log(`   合計: ${report.summary.total}件`);
    console.log(`   成功: ${report.summary.passed}件 ✅`);
    console.log(`   失敗: ${report.summary.failed}件 ❌`);
    console.log(`   実行時間: ${(report.summary.totalDuration / 1000).toFixed(2)}秒`);
  }

  /**
   * クリーンアップ
   */
  async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    console.log('\n🧹 クリーンアップ完了');
  }
}

// メイン実行
if (require.main === module) {
  (async () => {
    const orchestrator = new AITestOrchestrator();
    
    try {
      await orchestrator.initialize();

      // テストしたい機能
      const features = [
        'ログインとログアウト',
        'トレードノートの作成・編集・削除',
        'ダッシュボードの表示とチャート操作'
      ];

      for (const feature of features) {
        const scenarios = await orchestrator.generateTestScenarios(feature);
        
        for (const scenario of scenarios) {
          await orchestrator.runScenario(scenario);
        }
      }

      await orchestrator.generateReport();
      
    } catch (error) {
      console.error('❌ テスト実行中にエラーが発生しました:', error);
      process.exit(1);
    } finally {
      await orchestrator.cleanup();
    }
  })();
}
