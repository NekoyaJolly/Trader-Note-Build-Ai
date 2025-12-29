/**
 * アプリ共通フッター（Neon Dark テーマ対応）
 * 
 * 簡易なコピーライトと説明文を表示する。
 * モバイルではボトムナビの上に余白を確保。
 * 
 * @see docs/phase12/UI_DESIGN_GUIDE.md
 */
export default function Footer() {
  return (
    <footer className="w-full border-t border-slate-700 bg-slate-900 pb-20 md:pb-0">
      <div className="container mx-auto max-w-7xl px-4 py-6 text-center text-xs text-gray-500">
        <p>本システムは判断支援ツールです。自動売買は行いません。</p>
        <p className="mt-2">© 2025 TradeAssist MVP</p>
      </div>
    </footer>
  );
}
