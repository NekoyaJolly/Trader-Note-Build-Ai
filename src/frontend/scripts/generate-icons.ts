/**
 * アイコン生成スクリプト
 * 元画像から複数サイズのアイコンを生成
 */
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const sourceImage = path.join(__dirname, '../icons/Trade-Note-Icon-neon.png');
const outputDirs = {
  app: path.join(__dirname, '../app'),
  public: path.join(__dirname, '../public'),
};

// 生成するアイコンサイズの定義
const iconSizes = [
  { size: 16, name: 'icon-16x16.png', dir: 'public' },
  { size: 32, name: 'icon-32x32.png', dir: 'public' },
  { size: 96, name: 'icon-96x96.png', dir: 'public' },
  { size: 180, name: 'apple-icon-180x180.png', dir: 'public' },
  { size: 192, name: 'icon-192x192.png', dir: 'public' },
  { size: 512, name: 'icon-512x512.png', dir: 'public' },
  // appディレクトリ用
  { size: 32, name: 'icon.png', dir: 'app' },
  { size: 180, name: 'apple-icon.png', dir: 'app' },
];

async function generateIcons() {
  console.log('アイコン生成を開始します...');
  console.log(`元画像: ${sourceImage}`);

  // 元画像の存在確認
  if (!fs.existsSync(sourceImage)) {
    throw new Error(`元画像が見つかりません: ${sourceImage}`);
  }

  // 出力ディレクトリの確認・作成
  if (!fs.existsSync(outputDirs.app)) {
    fs.mkdirSync(outputDirs.app, { recursive: true });
  }
  if (!fs.existsSync(outputDirs.public)) {
    fs.mkdirSync(outputDirs.public, { recursive: true });
  }

  // 各サイズのアイコンを生成
  for (const icon of iconSizes) {
    const outputDir = icon.dir === 'app' ? outputDirs.app : outputDirs.public;
    const outputPath = path.join(outputDir, icon.name);

    try {
      await sharp(sourceImage)
        .resize(icon.size, icon.size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }, // 透明背景を保持
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ 生成完了: ${outputPath} (${icon.size}x${icon.size})`);
    } catch (error) {
      console.error(`✗ 生成失敗: ${outputPath}`, error);
      throw error;
    }
  }

  // favicon.icoの生成（16x16と32x32を含む）
  // Note: sharpはICO形式を直接生成できないため、32x32のPNGをfaviconとして使用
  // または、後でオンラインツールでICOに変換する必要がある
  const faviconPng = path.join(outputDirs.app, 'favicon.png');
  await sharp(sourceImage)
    .resize(32, 32, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(faviconPng);

  console.log(`✓ favicon.png 生成完了: ${faviconPng}`);
  console.log('⚠️  favicon.icoは手動で生成するか、オンラインツールを使用してください');

  console.log('\nアイコン生成が完了しました！');
}

// スクリプト実行
generateIcons().catch((error) => {
  console.error('エラーが発生しました:', error);
  process.exit(1);
});

