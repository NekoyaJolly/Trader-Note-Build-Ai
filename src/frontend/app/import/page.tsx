"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/Alert";
import { fetchProfileOptions, ProfileOption } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3100";

/**
 * 履歴インポート導線ページ
 * - CSV アップロード（テキスト送信）
 * - プロファイル選択（AIに任せる / プロファイルなし / ユーザープロファイル）
 * - 適用モード選択（一括 / 個別）
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

  // プロファイル選択
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("__AI_AUTO__");
  const [applyMode, setApplyMode] = useState<"bulk" | "individual">("bulk");
  const [userComment, setUserComment] = useState("");
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);

  // プロファイルオプション読み込み
  useEffect(() => {
    async function loadProfiles() {
      try {
        const options = await fetchProfileOptions();
        setProfileOptions(options);
        // デフォルト選択: isDefaultがtrueのものがあればそれを選択
        const defaultOption = options.find(o => o.isDefault);
        if (defaultOption) {
          setSelectedProfileId(defaultOption.id);
        }
      } catch (err) {
        console.error("プロファイルの読み込みに失敗:", err);
      } finally {
        setIsLoadingProfiles(false);
      }
    }
    loadProfiles();
  }, []);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [file]);

  // CSV をテキストとして送信する（バックエンドで保存→取り込み→ノート生成）
  async function uploadCsvText(csvText: string, filename: string) {
    const resp = await fetch(`${API_BASE_URL}/api/trades/import/upload-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        filename, 
        csvText,
        profileId: selectedProfileId,
        applyMode,
        userComment: userComment.trim() || undefined,
      }),
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

  // 選択中のプロファイル情報
  const selectedProfile = profileOptions.find(o => o.id === selectedProfileId);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ヘッダー */}
      <div className="text-center">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-white">トレード履歴インポート</h1>
      </div>

      {/* メインカード */}
      <div className="card-surface p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="space-y-2 sm:space-y-4 text-gray-300 mb-6">
          <p className="text-xs sm:text-sm md:text-base leading-relaxed font-medium">MT4/MT5などのCSV出力に対応</p>
          <p className="text-xs sm:text-sm md:text-base leading-relaxed text-gray-400">欠損データは自動スキップ</p>
        </div>

        <div className="space-y-4">
          {/* ファイル選択エリア */}
          <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center hover:border-cyan-500/50 transition-colors">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleSelect}
              className="hidden"
              id="csv-file-input"
            />
            <label
              htmlFor="csv-file-input"
              className="cursor-pointer block"
            >
              <div className="text-4xl mb-2">📁</div>
              <p className="text-sm text-gray-300 mb-1">
                {file ? file.name : "クリックしてCSVファイルを選択"}
              </p>
              <p className="text-xs text-gray-500">または、ファイルをドロップ</p>
            </label>
          </div>

          {/* プロファイル選択セクション */}
          {file && (
            <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <h3 className="text-sm font-medium text-white">インジケーター設定</h3>
              
              {/* プロファイル選択 */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">
                  プロファイル
                </label>
                {isLoadingProfiles ? (
                  <div className="text-gray-500 text-sm">読み込み中...</div>
                ) : (
                  <select
                    value={selectedProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
                  >
                    {profileOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.icon} {option.label}
                        {option.isDefault ? " (デフォルト)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {selectedProfile && (
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedProfile.description}
                  </p>
                )}
              </div>

              {/* 適用モード選択 */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">
                  適用モード
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setApplyMode("bulk")}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                      applyMode === "bulk"
                        ? "bg-violet-500/20 border border-violet-500 text-white"
                        : "bg-slate-700/50 border border-slate-600 text-gray-400 hover:border-slate-500"
                    }`}
                  >
                    一括適用
                  </button>
                  <button
                    type="button"
                    onClick={() => setApplyMode("individual")}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                      applyMode === "individual"
                        ? "bg-violet-500/20 border border-violet-500 text-white"
                        : "bg-slate-700/50 border border-slate-600 text-gray-400 hover:border-slate-500"
                    }`}
                  >
                    個別選択
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {applyMode === "bulk" 
                    ? "全てのトレードに同じプロファイルを適用" 
                    : "ノート作成後に各ノートで個別にプロファイルを選択"}
                </p>
              </div>

              {/* ユーザーコメント */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">
                  コメント（任意）
                </label>
                <textarea
                  value={userComment}
                  onChange={(e) => setUserComment(e.target.value)}
                  placeholder="このインポートに関するメモ..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none resize-none"
                />
              </div>

              {/* プロファイル管理リンク */}
              <div className="text-right">
                <a
                  href="/settings/profiles"
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  プロファイルを管理 →
                </a>
              </div>
            </div>
          )}

          {/* アクションボタン */}
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Button 
              onClick={handleUpload} 
              disabled={!file || isUploading} 
              size="sm"
              className="bg-gradient-to-r from-pink-500 to-violet-500 hover:opacity-90"
            >
              {isUploading ? "送信中…" : "アップロード"}
            </Button>
            <Button variant="outline" onClick={handleSkip} size="sm">スキップ</Button>
          </div>

          {/* 進捗バー */}
          {isUploading && (
            <div className="mt-2">
              <Progress value={progress} />
            </div>
          )}

          {/* 成功メッセージ */}
          {message && (
            <Alert className="bg-green-500/10 border-green-500/30 text-green-400">
              <AlertTitle>インポート完了</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {/* エラーメッセージ */}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>インポート失敗</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
