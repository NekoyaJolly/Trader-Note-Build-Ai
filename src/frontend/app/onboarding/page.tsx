"use client";

import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * 専用オンボーディングページ（初回アクセス時の説明用）
 * - モーダルが閉じられた後でも再訪できる導線として用意
 */
export default function OnboardingPage() {
  const router = useRouter();

  const handleTryNow = () => {
    try { localStorage.setItem("hasOnboarded", "true"); } catch {}
    router.push("/import");
  };

  const handleLater = () => {
    try { localStorage.setItem("hasOnboarded", "true"); } catch {}
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <Card>
          <CardHeader>
            <CardTitle>TradeAssist へようこそ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-gray-900">
              <p className="text-base leading-relaxed">本アプリは、過去トレードから AI 要約付きノートを自動生成し、判断の質を高める支援を行います。</p>
              <p className="text-base leading-relaxed">何もしない日があっても問題ありません。必要に応じて、控えめな通知でお知らせします。</p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <Button onClick={handleTryNow}>昨日のトレードをノートにしてみる</Button>
              <Button variant="outline" onClick={handleLater}>後でやる</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
