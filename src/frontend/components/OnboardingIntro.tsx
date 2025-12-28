"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * 初回オンボーディングコンポーネント
 * - アプリの役割を説明し、即時価値体験の導線を提示する
 * - 初回のみ表示（localStorage で判定）
 */
export default function OnboardingIntro() {
  const router = useRouter();
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    try {
      const flag = localStorage.getItem("hasOnboarded");
      setShouldShow(!flag);
    } catch {
      // localStorage 未対応環境でも安全に非表示とする
      setShouldShow(false);
    }
  }, []);

  const handleTryNow = () => {
    try {
      localStorage.setItem("hasOnboarded", "true");
    } catch {}
    router.push("/import");
  };

  const handleLater = () => {
    try {
      localStorage.setItem("hasOnboarded", "true");
    } catch {}
    setShouldShow(false);
  };

  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <Card className="max-w-xl w-full">
        <CardHeader>
          <CardTitle>TradeAssist へようこそ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-gray-900">
            <p className="text-base leading-relaxed">本アプリは、過去のトレード履歴から自動でノートを作成し、判断・記録を補助します。</p>
            <p className="text-base leading-relaxed">トレードがない日は何もしなくて問題ありません。通知は控えめで、必要な時だけお知らせします。</p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={handleTryNow}>
              昨日のトレードをノートにしてみる
            </Button>
            <Button variant="outline" onClick={handleLater}>
              後でやる
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
