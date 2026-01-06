'use client';

import { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Neko } from './Neko';
import type { NekoState, BubblePosition } from '@/types/neko';
import { cn } from '@/lib/utils';

/** NekoAssistantのコンテキスト型 */
interface NekoAssistantContextType {
  /** メッセージを表示 */
  say: (message: string, state?: NekoState, duration?: number) => void;
  /** 状態を変更 */
  setState: (state: NekoState) => void;
  /** 非表示にする */
  hide: () => void;
  /** 表示する */
  show: () => void;
  /** 現在の状態 */
  state: NekoState;
  /** 表示中かどうか */
  isVisible: boolean;
}

const NekoAssistantContext = createContext<NekoAssistantContextType | null>(null);

/** NekoAssistantを使うためのフック */
export function useNekoAssistant() {
  const context = useContext(NekoAssistantContext);
  if (!context) {
    throw new Error('useNekoAssistant must be used within NekoAssistantProvider');
  }
  return context;
}

interface NekoAssistantProviderProps {
  children: ReactNode;
  /** 初期表示状態 */
  initialVisible?: boolean;
  /** 吹き出しの位置 */
  bubblePosition?: BubblePosition;
}

/**
 * 右下固定のNekoアシスタントを提供するプロバイダー
 * アプリ全体で使えるようにlayoutで囲む
 */
export function NekoAssistantProvider({
  children,
  initialVisible = true,
  bubblePosition = 'left',
}: NekoAssistantProviderProps) {
  const [state, setStateInternal] = useState<NekoState>('idle');
  const [message, setMessage] = useState<string>('');
  const [isVisible, setIsVisible] = useState(initialVisible);
  const [isMinimized, setIsMinimized] = useState(false);

  // メッセージを表示（一定時間後に自動で消える）
  const say = useCallback((msg: string, newState: NekoState = 'speaking', duration = 5000) => {
    setMessage(msg);
    setStateInternal(newState);
    setIsMinimized(false);

    if (duration > 0) {
      setTimeout(() => {
        setMessage('');
        setStateInternal('idle');
      }, duration);
    }
  }, []);

  // 状態変更
  const setState = useCallback((newState: NekoState) => {
    setStateInternal(newState);
  }, []);

  // 非表示
  const hide = useCallback(() => {
    setIsVisible(false);
  }, []);

  // 表示
  const show = useCallback(() => {
    setIsVisible(true);
  }, []);

  // 最小化トグル
  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
    if (!isMinimized) {
      setMessage('');
    }
  }, [isMinimized]);

  return (
    <NekoAssistantContext.Provider value={{ say, setState, hide, show, state, isVisible }}>
      {children}

      {/* 右下固定のNekoアシスタント */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              'fixed bottom-4 right-4 z-50',
              'flex flex-col items-end gap-2'
            )}
          >
            {/* 最小化/展開ボタン */}
            <button
              onClick={toggleMinimize}
              className={cn(
                'rounded-full bg-slate-800/80 p-1 text-xs text-white',
                'hover:bg-slate-700 transition-colors',
                'backdrop-blur-sm'
              )}
            >
              {isMinimized ? '🐱' : '−'}
            </button>

            {/* Nekoキャラクター */}
            <AnimatePresence>
              {!isMinimized && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  <Neko
                    state={state}
                    size={120}
                    message={message}
                    bubblePosition={bubblePosition}
                    onClick={() => {
                      // クリックしたらランダムな挨拶
                      const greetings = [
                        'にゃ〜！何かお手伝いすることある？',
                        'トレード頑張ってるね！',
                        '今日も一緒に分析しよう！',
                        'ボクはNekoだよ！よろしくね！',
                      ];
                      say(greetings[Math.floor(Math.random() * greetings.length)], 'speaking', 3000);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 最小化時のアイコン */}
            <AnimatePresence>
              {isMinimized && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className={cn(
                    'w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600',
                    'flex items-center justify-center cursor-pointer',
                    'shadow-lg shadow-cyan-500/30',
                    'hover:scale-110 transition-transform'
                  )}
                  onClick={() => setIsMinimized(false)}
                >
                  <span className="text-2xl">🐱</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </NekoAssistantContext.Provider>
  );
}

export default NekoAssistantProvider;
