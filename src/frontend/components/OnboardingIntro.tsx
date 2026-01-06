"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Neko } from "@/components/characters";
import type { NekoState } from "@/types/neko";

/**
 * 初回オンボーディングコンポーネント
 * - アプリの役割を説明し、即時価値体験の導線を提示する
 * - 初回のみ表示（localStorage で判定）
 */
export default function OnboardingIntro() {
  const router = useRouter();
  const [shouldShow, setShouldShow] = useState(false);
  const [nekoState, setNekoState] = useState<NekoState>('idle');
  const [nekoMessage, setNekoMessage] = useState('');

  useEffect(() => {
    try {
      const flag = localStorage.getItem("hasOnboarded");
      setShouldShow(!flag);
      // オンボーディング表示時にNekoが挨拶
      if (!flag) {
        setTimeout(() => {
          setNekoState('speaking');
          setNekoMessage('はじめまして！\nボクはNekoだよ！\n一緒にトレードを記録しよう！');
        }, 500);
      }
    } catch {
      // localStorage 未対応環境でも安全に非表示とする
      setShouldShow(false);
    }
  }, []);

  const handleTryNow = () => {
    setNekoState('success');
    setNekoMessage('やったー！\n一緒に頑張ろうね！');
    setTimeout(() => {
      try {
        localStorage.setItem("hasOnboarded", "true");
      } catch {}
      router.push("/import");
    }, 1000);
  };

  const handleLater = () => {
    setNekoState('idle');
    setNekoMessage('わかった！\nいつでも待ってるよ〜');
    setTimeout(() => {
      try {
        localStorage.setItem("hasOnboarded", "true");
      } catch {}
      setShouldShow(false);
    }, 1000);
  };

  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <Card className="max-w-xl w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-4">
            {/* Nekoキャラクター */}
            <div className="flex-shrink-0">
              <Neko 
                state={nekoState} 
                size={100} 
                message={nekoMessage}
                bubblePosition="right"
              />
            </div>
            <span>TradeAssist へようこそ</span>
          </CardTitle>
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
