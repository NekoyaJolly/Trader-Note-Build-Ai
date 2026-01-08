/**
 * cTrader WebSocket 接続テストスクリプト
 * 
 * 目的: cTrader Open API WebSocket に接続してリアルタイムデータを取得
 * 
 * 使用方法:
 *   npx ts-node scripts/test-ctrader-websocket.ts
 * 
 * 環境変数:
 *   CTRADER_TEST_ACCESS_TOKEN - アクセストークン（オプション、DBから取得も可）
 */

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';

// @reiryoku/ctrader-layer を使用
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CTraderConnection } = require('@reiryoku/ctrader-layer');

const prisma = new PrismaClient();

// 型定義
interface CTraderAccount {
  ctidTraderAccountId: number;
  isLive: boolean;
  traderLogin: number;
}

interface CTraderSymbol {
  symbolId: number;
  symbolName: string;
}

interface CTraderSpotEvent {
  symbolId?: number;
  bid?: number;
  ask?: number;
  timestamp?: number;
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('cTrader WebSocket 接続テスト（ctrader-layer使用）');
  console.log('='.repeat(60));

  // 1. トークン取得
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.log('\n❌ アクセストークンが見つかりません');
    console.log('   先に認証フローを完了してください');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n🔑 アクセストークン: ${maskToken(accessToken)}`);

  // 2. cTrader接続
  await testConnection(accessToken);

  await prisma.$disconnect();
}

/**
 * DBまたは環境変数からアクセストークンを取得
 */
async function getAccessToken(): Promise<string> {
  // 環境変数から取得
  if (process.env.CTRADER_TEST_ACCESS_TOKEN) {
    console.log('📋 環境変数からトークン取得');
    return process.env.CTRADER_TEST_ACCESS_TOKEN;
  }

  // DBから最新のトークンを取得
  console.log('📋 DBからトークン取得中...');
  const token = await prisma.cTraderToken.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (token) {
    console.log(`  アカウントID: ${token.accountId}`);
    console.log(`  有効期限: ${token.expiresAt.toISOString()}`);
    
    if (token.expiresAt < new Date()) {
      console.log('  ⚠️ トークンが期限切れです');
      return '';
    }
    
    return token.accessToken;
  }

  return '';
}

/**
 * cTrader接続テスト
 */
async function testConnection(accessToken: string): Promise<void> {
  console.log('\n🔄 cTrader接続中...');
  console.log(`  Client ID: ${config.ctrader.clientId ? '設定済み' : '未設定'}`);
  console.log(`  Client Secret: ${config.ctrader.clientSecret ? '設定済み' : '未設定'}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let connection: any = null;

  try {
    // cTrader接続を作成（Live環境 - アカウントがLiveの場合）
    // Demo環境: demo.ctraderapi.com:5035
    // Live環境: live.ctraderapi.com:5035
    connection = new CTraderConnection({
      host: 'live.ctraderapi.com',
      port: 5035,
    });

    // 接続開始
    console.log('\n📡 WebSocket接続中...');
    await connection.open();
    console.log('✅ WebSocket 接続成功！');

    // ハートビート開始
    const heartbeatInterval = setInterval(() => {
      try {
        connection.sendHeartbeat();
      } catch {
        // ignore
      }
    }, 25000);

    // アプリケーション認証
    console.log('\n🔐 アプリケーション認証中...');
    await connection.sendCommand('ProtoOAApplicationAuthReq', {
      clientId: config.ctrader.clientId,
      clientSecret: config.ctrader.clientSecret,
    });
    console.log('✅ アプリケーション認証成功！');

    // WebSocket経由でアカウント情報を取得
    console.log('\n📋 アカウント情報取得中（WebSocket）...');
    const accountsResponse = await connection.sendCommand('ProtoOAGetAccountListByAccessTokenReq', {
      accessToken: accessToken,
    });
    const accounts: CTraderAccount[] = accountsResponse?.ctidTraderAccount || [];
    
    if (accounts && accounts.length > 0) {
      console.log(`✅ アカウント数: ${accounts.length}`);
      
      for (const account of accounts) {
        console.log(`\n  📊 アカウント情報:`);
        console.log(`     ID: ${account.ctidTraderAccountId}`);
        console.log(`     Live: ${account.isLive}`);
        console.log(`     Login: ${account.traderLogin}`);
        
        // アカウント認証
        console.log(`\n🔐 アカウント ${account.ctidTraderAccountId} を認証中...`);
        await connection.sendCommand('ProtoOAAccountAuthReq', {
          ctidTraderAccountId: account.ctidTraderAccountId,
          accessToken: accessToken,
        });
        console.log('✅ アカウント認証成功！');

        // シンボル一覧取得
        console.log('\n📊 シンボル一覧取得中...');
        const symbolsResponse = await connection.sendCommand('ProtoOASymbolsListReq', {
          ctidTraderAccountId: account.ctidTraderAccountId,
        });
        
        const symbols: CTraderSymbol[] = symbolsResponse?.symbol || [];
        console.log(`✅ シンボル数: ${symbols.length}`);
        
        // XAUUSD を探す
        const xauusd = symbols.find((s: CTraderSymbol) => 
          s.symbolName?.includes('XAUUSD') || s.symbolName?.includes('XAU/USD') || s.symbolName?.includes('GOLD')
        );
        
        if (xauusd) {
          console.log(`\n🎯 XAUUSD found: ID=${xauusd.symbolId}, Name=${xauusd.symbolName}`);
          
          // Tickイベントをリッスン（全イベントをキャッチ）
          let tickCount = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          connection.on('message', (message: any) => {
            if (message.payloadType === 'ProtoOASpotEvent' || message.payloadType === 2128) {
              tickCount++;
              if (tickCount <= 5) {
                console.log(`  📊 Tick #${tickCount} (raw):`, JSON.stringify(message));
              } else {
                const payload = message.payload || message;
                console.log(`  📊 Tick #${tickCount}: bid=${payload.bid}, ask=${payload.ask}`);
              }
            }
          });
          
          // Tick購読
          console.log('\n📈 Tick データ購読開始...');
          await connection.sendCommand('ProtoOASubscribeSpotsReq', {
            ctidTraderAccountId: account.ctidTraderAccountId,
            symbolId: [xauusd.symbolId],
          });
          console.log('✅ Tick 購読成功！');
          
          // 15秒間データを受信
          console.log('\n⏱️ 15秒間リアルタイムデータを受信中...');
          await new Promise(resolve => setTimeout(resolve, 15000));
        } else {
          // 最初の10シンボルを表示
          console.log('\n  最初の10シンボル:');
          symbols.slice(0, 10).forEach((s: CTraderSymbol) => {
            console.log(`    - ${s.symbolName} (ID: ${s.symbolId})`);
          });
        }
        
        // 最初のアカウントのみテスト
        break;
      }
    } else {
      console.log('⚠️ アカウントが見つかりません');
    }

    // ハートビート停止
    clearInterval(heartbeatInterval);

    // 接続を閉じる
    console.log('\n🔌 接続を終了します...');
    await connection.close();

  } catch (error) {
    console.log('❌ エラー:', error);
    if (connection) {
      try {
        await connection.close();
      } catch {
        // ignore
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('テスト完了');
  console.log('='.repeat(60));
}

/**
 * トークンをマスク表示
 */
function maskToken(token: string): string {
  if (token.length <= 10) return '***';
  return `${token.substring(0, 5)}...${token.substring(token.length - 5)}`;
}

// 実行
main().catch(console.error);