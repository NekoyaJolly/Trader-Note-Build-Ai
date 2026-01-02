"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3100";

/**
 * 履歴インポート導線ページ
 * - CSV アップロード（テキスト送信）
 * - 進捗表示、成功/失敗フィードバック
 * - 成功後は Draft ノート詳細へ自動遷移
 */
export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [file]);

  // CSV をテキストとして送信する（バックエンドで保存→取り込み→ノート生成）
  async function uploadCsvText(csvText: string, filename: string) {
    const resp = await fetch(`${API_BASE_URL}/api/trades/import/upload-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, csvText }),
    });
    if (!resp.ok) {
      throw new Error(`アップロードに失敗しました: ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  const handleSelect: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setProgress(10);
    setMessage(null);
    setError(null);

    try {
      // ファイルをテキストとして読み込み（形式は厳密でなくてよい）
      const text = await file.text();
      setProgress(40);

      const result = await uploadCsvText(text, file.name);
      setProgress(80);

      const imported = result?.tradesImported ?? 0;
      const noteIds: string[] = result?.noteIds ?? [];
      setMessage(`\u25CF ${imported}件のトレードを読み込みました。ノートを作成しています…`);
      setProgress(100);

      // 最初のノート詳細へ自動遷移
      if (noteIds.length > 0) {
        setTimeout(() => router.push(`/notes/${noteIds[0]}`), 600);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "アップロード処理に失敗しました";
      // 技術用語を避けた表現に整形
      setError(`${msg}。CSV の形式が完全でなくても問題ありません。再試行してください。`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSkip = () => {
    setMessage("トレードがあれば自動でノートが作成されます。何もしなくて問題ありません。");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-6 sm:py-8 md:py-12 text-gray-900 dark:text-slate-100">
      <div className="max-w-3xl mx-auto px-3 sm:px-4">
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="text-slate-900 dark:text-slate-100">トレード履歴インポート</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 sm:space-y-4 text-gray-900 dark:text-slate-100">
              <p className="text-xs sm:text-sm md:text-base leading-relaxed font-medium">MT4/MT5などのCSV出力に対応</p>
              <p className="text-xs sm:text-sm md:text-base leading-relaxed">欠損データは自動スキップ</p>
            </div>

            <div className="mt-4 sm:mt-6 space-y-3">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleSelect}
                className="block w-full rounded border border-slate-200 dark:border-slate-600 p-2 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm"
              />

              <div className="flex items-center gap-2 sm:gap-3">
                <Button onClick={handleUpload} disabled={!file || isUploading} size="sm">
                  {isUploading ? "送信中…" : "アップロード"}
                </Button>
                <Button variant="outline" onClick={handleSkip} size="sm">スキップ</Button>
              </div>

              {isUploading && (
                <div className="mt-2">
                  <Progress value={progress} />
                </div>
              )}

              {message && (
                <Alert>
                  <AlertTitle className="text-slate-900 dark:text-slate-100">インポート完了</AlertTitle>
                  <AlertDescription className="text-gray-800 dark:text-slate-100">{message}</AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertTitle className="text-slate-900 dark:text-slate-100">インポート失敗</AlertTitle>
                  <AlertDescription className="text-gray-800 dark:text-slate-100">{error}</AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
