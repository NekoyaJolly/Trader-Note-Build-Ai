/**
 * 画像サイズ確認スクリプト
 */
import sharp from 'sharp';
import * as path from 'path';

const sourceImage = path.join(__dirname, '../icons/Trade-Note-Icon-neon.png');

async function checkImageSize() {
  try {
    const metadata = await sharp(sourceImage).metadata();
    console.log('元画像の情報:');
    console.log(`  幅: ${metadata.width}px`);
    console.log(`  高さ: ${metadata.height}px`);
    console.log(`  アスペクト比: ${(metadata.width! / metadata.height!).toFixed(2)}:1`);
    console.log(`  形式: ${metadata.format}`);
    console.log(`  チャンネル数: ${metadata.channels}`);
    
    if (metadata.width !== metadata.height) {
      console.log('\n⚠️  画像は正方形ではありません');
      if (metadata.width! > metadata.height!) {
        console.log('  横長の画像です。上下に余白が生じる可能性があります。');
      } else {
        console.log('  縦長の画像です。左右に余白が生じる可能性があります。');
      }
    } else {
      console.log('\n✓ 画像は正方形です');
    }
  } catch (error) {
    console.error('エラー:', error);
  }
}

checkImageSize();

