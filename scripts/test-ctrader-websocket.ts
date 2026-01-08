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

import WebSocket from 'ws';
import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';

const prisma = new PrismaClient();

// cTrader Open API メッセージタイプ
const MessageType = {
  PROTO_OA_APPLICATION_AUTH_REQ: 2100,
  PROTO_OA_APPLICATION_AUTH_RES: 2101,
  PROTO_OA_ACCOUNT_AUTH_REQ: 2102,
  PROTO_OA_ACCOUNT_AUTH_RES: 2103,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  PROTO_OA_SUBSCRIBE_SPOTS_REQ: 2124,
  PROTO_OA_SUBSCRIBE_SPOTS_RES: 2125,
  PROTO_OA_SPOT_EVENT: 2128,
  PROTO_OA_SYMBOL_BY_ID_REQ: 2114,
  PROTO_OA_SYMBOL_BY_ID_RES: 2115,
  PROTO_OA_SYMBOLS_LIST_REQ: 2116,
  PROTO_OA_SYMBOLS_LIST_RES: 2117,
  PROTO_OA_ERROR_RES: 2142,
  HEARTBEAT_EVENT: 51,
} as const;

// WebSocket URL（デモ環境を使用）
const WS_URL = 'wss://demo.ctraderapi.com:5035';

let ws: WebSocket | null = null;
let accessToken: string = '';
let ctidTraderAccountId: number = 0;

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('cTrader WebSocket 接続テスト');
  console.log('='.repeat(60));

  // 1. トークン取得
  accessToken = await getAccessToken();
  if (!accessToken) {
    console.log('\n❌ アクセストークンが見つかりません');
    console.log('   先に認証フローを完了してください');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n🔑 アクセストークン: ${maskToken(accessToken)}`);
  console.log(`📡 WebSocket URL: ${WS_URL}`);

  // 2. WebSocket 接続
  await connectWebSocket();
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
 * WebSocket 接続
 */
async function connectWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    console.log('\n🔄 WebSocket 接続中...');

    ws = new WebSocket(WS_URL);

    ws.on('open', async () => {
      console.log('✅ WebSocket 接続成功！');
      
      // アプリケーション認証
      await authenticateApplication();
    });

    ws.on('message', async (data: Buffer) => {
      await handleMessage(data);
    });

    ws.on('error', (error) => {
      console.log('❌ WebSocket エラー:', error.message);
    });

    ws.on('close', (code, reason) => {
      console.log(`\n🔌 WebSocket 切断: code=${code}, reason=${reason.toString()}`);
      resolve();
    });

    // 30秒後に自動切断
    setTimeout(() => {
      console.log('\n⏱️ タイムアウト（30秒）- 接続を終了します');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      prisma.$disconnect();
    }, 30000);
  });
}

/**
 * アプリケーション認証
 */
async function authenticateApplication(): Promise<void> {
  console.log('\n🔐 アプリケーション認証中...');
  
  const message = {
    payloadType: MessageType.PROTO_OA_APPLICATION_AUTH_REQ,
    payload: {
      clientId: config.ctrader.clientId,
      clientSecret: config.ctrader.clientSecret,
    },
  };

  sendMessage(message);
}

/**
 * アカウント一覧取得
 */
async function getAccountsByToken(): Promise<void> {
  console.log('\n📋 アカウント一覧取得中...');
  
  const message = {
    payloadType: MessageType.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
    payload: {
      accessToken: accessToken,
    },
  };

  sendMessage(message);
}

/**
 * アカウント認証
 */
async function authenticateAccount(accountId: number): Promise<void> {
  console.log(`\n🔐 アカウント認証中... (ID: ${accountId})`);
  
  const message = {
    payloadType: MessageType.PROTO_OA_ACCOUNT_AUTH_REQ,
    payload: {
      ctidTraderAccountId: accountId,
      accessToken: accessToken,
    },
  };

  sendMessage(message);
}

/**
 * シンボル一覧取得
 */
async function getSymbolsList(): Promise<void> {
  console.log('\n📊 シンボル一覧取得中...');
  
  const message = {
    payloadType: MessageType.PROTO_OA_SYMBOLS_LIST_REQ,
    payload: {
      ctidTraderAccountId: ctidTraderAccountId,
    },
  };

  sendMessage(message);
}

/**
 * Tick データ購読
 */
async function subscribeSpots(symbolId: number): Promise<void> {
  console.log(`\n📈 Tick 購読開始... (symbolId: ${symbolId})`);
  
  const message = {
    payloadType: MessageType.PROTO_OA_SUBSCRIBE_SPOTS_REQ,
    payload: {
      ctidTraderAccountId: ctidTraderAccountId,
      symbolId: [symbolId],
    },
  };

  sendMessage(message);
}

/**
 * メッセージ送信
 */
function sendMessage(message: { payloadType: number; payload: Record<string, unknown> }): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const json = JSON.stringify(message);
    console.log(`  → 送信: ${message.payloadType}`);
    ws.send(json);
  }
}

/**
 * メッセージ受信処理
 */
async function handleMessage(data: Buffer): Promise<void> {
  try {
    const message = JSON.parse(data.toString()) as {
      payloadType: number;
      payload?: Record<string, unknown>;
    };

    console.log(`  ← 受信: ${message.payloadType}`);

    switch (message.payloadType) {
      case MessageType.PROTO_OA_APPLICATION_AUTH_RES:
        console.log('✅ アプリケーション認証成功！');
        // アカウント一覧取得
        await getAccountsByToken();
        break;

      case MessageType.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES:
        console.log('✅ アカウント一覧取得成功！');
        const accounts = (message.payload as { ctidTraderAccount?: Array<{ ctidTraderAccountId: number; isLive: boolean; traderLogin: number }> })?.ctidTraderAccount || [];
        if (accounts.length > 0) {
          console.log(`  アカウント数: ${accounts.length}`);
          accounts.forEach((acc, i) => {
            console.log(`    ${i + 1}. ID: ${acc.ctidTraderAccountId}, Live: ${acc.isLive}, Login: ${acc.traderLogin}`);
          });
          // 最初のアカウントで認証
          ctidTraderAccountId = accounts[0].ctidTraderAccountId;
          await authenticateAccount(ctidTraderAccountId);
        } else {
          console.log('  ⚠️ アカウントが見つかりません');
        }
        break;

      case MessageType.PROTO_OA_ACCOUNT_AUTH_RES:
        console.log('✅ アカウント認証成功！');
        // シンボル一覧取得
        await getSymbolsList();
        break;

      case MessageType.PROTO_OA_SYMBOLS_LIST_RES:
        console.log('✅ シンボル一覧取得成功！');
        const symbols = (message.payload as { symbol?: Array<{ symbolId: number; symbolName: string }> })?.symbol || [];
        console.log(`  シンボル数: ${symbols.length}`);
        
        // XAUUSD を探す
        const xauusd = symbols.find(s => s.symbolName?.includes('XAUUSD') || s.symbolName?.includes('XAU/USD'));
        if (xauusd) {
          console.log(`  🎯 XAUUSD found: ID=${xauusd.symbolId}, Name=${xauusd.symbolName}`);
          await subscribeSpots(xauusd.symbolId);
        } else {
          // 最初の5つのシンボルを表示
          console.log('  最初の5シンボル:');
          symbols.slice(0, 5).forEach(s => {
            console.log(`    - ${s.symbolName} (ID: ${s.symbolId})`);
          });
          // 最初のシンボルで購読テスト
          if (symbols.length > 0) {
            await subscribeSpots(symbols[0].symbolId);
          }
        }
        break;

      case MessageType.PROTO_OA_SUBSCRIBE_SPOTS_RES:
        console.log('✅ Tick 購読成功！リアルタイムデータを待機中...');
        break;

      case MessageType.PROTO_OA_SPOT_EVENT:
        const spot = message.payload as { symbolId?: number; bid?: number; ask?: number; timestamp?: number };
        const time = spot.timestamp ? new Date(spot.timestamp).toISOString() : 'N/A';
        console.log(`  📊 Tick: symbolId=${spot.symbolId}, bid=${spot.bid}, ask=${spot.ask}, time=${time}`);
        break;

      case MessageType.PROTO_OA_ERROR_RES:
        const error = message.payload as { errorCode?: string; description?: string };
        console.log(`❌ エラー: ${error.errorCode} - ${error.description}`);
        break;

      case MessageType.HEARTBEAT_EVENT:
        // ハートビートは無視
        break;

      default:
        console.log(`  未処理メッセージ: ${message.payloadType}`);
    }
  } catch (error) {
    console.log('❌ メッセージパースエラー:', error);
  }
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

