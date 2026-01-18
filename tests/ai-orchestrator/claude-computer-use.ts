import Anthropic from '@anthropic-ai/sdk';
import { chromium, Page, Browser, BrowserContext } from 'playwright';
import fs from 'fs/promises';

/**
 * Claude Computer Use エージェント
 * 目的: Claude 3.5 Sonnetのコンピュータ操作機能を使用してUIテストを実行
 * 注意: Anthropic APIを使用するため課金が発生します
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ComputerUseResult {
  success: boolean;
  steps: string[];
  finalState: string;
  screenshots: string[];
}

export class ClaudeComputerUseAgent {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async initialize(url: string) {
    console.log('🚀 Claude Computer Use エージェント起動中...');
    
    this.browser = await chromium.launch({ 
      headless: false // Computer Useは画面が必要
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    
    this.page = await this.context.newPage();
    await this.page.goto(url);
    
    console.log('✅ 初期化完了');
  }

  async runTest(testInstructions: string): Promise<ComputerUseResult> {
    if (!this.page) throw new Error('Page not initialized');

    console.log('\n🤖 Claudeがテストを実行中...');
    console.log(`指示: ${testInstructions}`);

    const result: ComputerUseResult = {
      success: false,
      steps: [],
      finalState: '',
      screenshots: []
    };

    try {
      // 初期スクリーンショット
      const screenshot = await this.page.screenshot({ encoding: 'base64' });

      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        tools: [{
          type: "computer_20241022",
          name: "computer",
          display_width_px: 1920,
          display_height_px: 1080,
          display_number: 1
        }],
        messages: [{
          role: "user",
          content: `TradeAssistアプリケーション（トレード支援システム）で以下のテストを実行してください:

${testInstructions}

現在の画面:
画面幅: 1920px
画面高さ: 1080px

各ステップの実行後、結果を報告してください。
最終的に、テストが成功したか失敗したかを明確に述べてください。`
        }]
      });

      // Claudeのレスポンスを解析
      for (const content of response.content) {
        if (content.type === 'text') {
          result.steps.push(content.text);
          result.finalState = content.text;
        }
      }

      // 最終スクリーンショット保存
      const finalScreenshotPath = './playwright-report/claude-final.png';
      await this.page.screenshot({ path: finalScreenshotPath });
      result.screenshots.push(finalScreenshotPath);

      result.success = result.finalState.includes('成功') || 
                       result.finalState.includes('success') ||
                       result.finalState.toLowerCase().includes('pass');

      console.log(`\n${result.success ? '✅' : '❌'} テスト${result.success ? '成功' : '失敗'}`);
      console.log(`最終状態: ${result.finalState}`);

    } catch (error) {
      console.error('❌ エラー:', error);
      result.success = false;
      result.finalState = `エラー: ${error}`;
    }

    return result;
  }

  async cleanup(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    console.log('🧹 クリーンアップ完了');
  }
}

// 使用例
if (require.main === module) {
  (async () => {
    const agent = new ClaudeComputerUseAgent();
    
    try {
      await agent.initialize('http://localhost:3102');
      
      const result = await agent.runTest(`
1. test@example.com / password123 でログインする
2. ダッシュボードに「今日のトレード」セクションが表示されることを確認
3. 新規トレードノートを作成:
   - シンボル: USDJPY
   - 方向: BUY
   - エントリー価格: 150.50
   - 数量: 10000
   - 戦略: RSIが30を下回ったため買いエントリー
4. ノートが正しく保存されたことを確認
5. 作成したノートを削除
6. 削除が成功したことを確認
      `);

      console.log('\n📊 テスト結果:', result.success ? '✅ 成功' : '❌ 失敗');
      console.log('実行ステップ:', result.steps);
      
      // 結果をJSONファイルに保存
      await fs.writeFile(
        './playwright-report/claude-test-result.json',
        JSON.stringify(result, null, 2),
        'utf-8'
      );
      
    } catch (error) {
      console.error('❌ テスト実行中にエラーが発生しました:', error);
      process.exit(1);
    } finally {
      await agent.cleanup();
    }
  })();
}
