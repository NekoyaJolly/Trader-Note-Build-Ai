/**
 * ストラテジー新規作成ページ
 * 
 * 目的:
 * - 新しいストラテジーを作成するフォームを表示
 */

"use client";

import React from "react";
import Link from "next/link";
import StrategyForm from "@/components/strategy/StrategyForm";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function NewStrategyPage() {
  return (
    <div className="flex h-screen bg-slate-900">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {/* パンくずリスト */}
            <nav className="mb-6">
              <ol className="flex items-center gap-2 text-sm">
                <li>
                  <Link href="/strategies" className="text-gray-400 hover:text-blue-400">
                    ストラテジー
                  </Link>
                </li>
                <li className="text-gray-500">/</li>
                <li className="text-gray-200">新規作成</li>
              </ol>
            </nav>

            {/* ページヘッダー */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-200">新規ストラテジー作成</h1>
              <p className="text-gray-400 text-sm mt-1">
                インジケーター条件を組み合わせて、エントリー戦略を定義します
              </p>
            </div>

            {/* フォーム */}
            <StrategyForm />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
