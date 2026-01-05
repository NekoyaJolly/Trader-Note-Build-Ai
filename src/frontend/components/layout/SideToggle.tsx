"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useCallback } from "react";

/**
 * Side-A / Side-B 切り替えトグル
 * 
 * 機能:
 * - 現在のサイドを表示（Side-A または Side-B）
 * - スライダーで切り替え
 * - sessionStorageで最後のページを記憶
 * - ブラウザ閉じたらリセット（sessionStorage）
 */

type Side = "side-a" | "side-b";

// 各サイドのデフォルトページ
const DEFAULT_PAGES: Record<Side, string> = {
  "side-a": "/",
  "side-b": "/side-b",
};

// sessionStorageのキー
const STORAGE_KEY_PREFIX = "lastPage.";

export default function SideToggle() {
  const pathname = usePathname();
  const router = useRouter();

  // 現在のサイドを判定
  const currentSide: Side = pathname.startsWith("/side-b") ? "side-b" : "side-a";

  // 現在のページを保存
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${currentSide}`, pathname);
    }
  }, [pathname, currentSide]);

  // サイド切り替え処理
  const switchSide = useCallback((targetSide: Side) => {
    if (targetSide === currentSide) return;

    // 切り替え先の最後のページを取得（なければデフォルト）
    const lastPage = typeof window !== "undefined"
      ? sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${targetSide}`) || DEFAULT_PAGES[targetSide]
      : DEFAULT_PAGES[targetSide];

    router.push(lastPage);
  }, [currentSide, router]);

  // Side-Aの色（青系）、Side-Bの色（紫系）
  const isB = currentSide === "side-b";

  return (
    <div className="flex flex-col items-start leading-tight">
      {/* 上段: 現在のサイド名 */}
      <span 
        className={`text-xs font-semibold tracking-wide transition-colors duration-300 ${
          isB ? "text-purple-400" : "text-cyan-400"
        }`}
      >
        {isB ? "Side-B" : "Side-A"}
      </span>
      
      {/* 下段: スライダー */}
      <button
        onClick={() => switchSide(isB ? "side-a" : "side-b")}
        className="relative w-10 h-4 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-slate-900 focus:ring-cyan-500"
        style={{
          background: isB 
            ? "linear-gradient(to right, #6366f1, #a855f7)" 
            : "linear-gradient(to right, #06b6d4, #3b82f6)",
        }}
        aria-label={`${isB ? "Side-A" : "Side-B"}に切り替え`}
      >
        {/* スライダーつまみ */}
        <span
          className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-md transition-all duration-300 ${
            isB ? "left-6" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
