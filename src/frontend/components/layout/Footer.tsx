/**
 * アプリ共通フッター
 * 簡易なコピーライトと説明文を表示する。
 */
export default function Footer() {
  return (
    <footer className="w-full border-t bg-white">
      <div className="container mx-auto max-w-7xl px-4 py-6 text-center text-xs text-gray-500">
        <p>本システムは判断支援ツールです。自動売買は行いません。</p>
        <p className="mt-2">© 2025 TradeAssist MVP</p>
      </div>
    </footer>
  );
}
