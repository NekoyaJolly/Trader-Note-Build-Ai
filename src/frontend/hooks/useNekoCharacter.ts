'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { NekoState, NekoFace, STATE_TO_FACE } from '@/types/neko';

/** 状態ごとの表情マッピング */
const stateToFace: Record<NekoState, NekoFace> = {
  idle: 'normal',
  listening: 'smile',
  thinking: 'thinking',
  speaking: 'talk-1',
  explaining: 'talk-2',
  success: 'big-laugh',
  error: 'worried',
};

/** 口パク用の表情切り替え */
const talkFaces: NekoFace[] = ['talk-1', 'talk-2'];

interface UseNekoCharacterOptions {
  /** 初期状態 */
  initialState?: NekoState;
  /** 口パクの速度（ms） */
  talkInterval?: number;
  /** 目パチの間隔（ms） */
  blinkInterval?: number;
}

interface UseNekoCharacterReturn {
  /** 現在の状態 */
  state: NekoState;
  /** 現在の表情 */
  face: NekoFace;
  /** 状態を変更 */
  setState: (state: NekoState) => void;
  /** アイドル状態に戻す */
  goIdle: () => void;
  /** 思考状態に */
  startThinking: () => void;
  /** 話し始める */
  startSpeaking: (duration?: number) => void;
  /** 成功アニメーション */
  celebrate: (duration?: number) => void;
  /** エラー表示 */
  showError: (duration?: number) => void;
}

/**
 * Nekoキャラクターの状態とアニメーションを管理するフック
 * AI思考状態と連携してキャラクターを動かす
 */
export function useNekoCharacter(options: UseNekoCharacterOptions = {}): UseNekoCharacterReturn {
  const {
    initialState = 'idle',
    talkInterval = 150,
  } = options;

  const [state, setStateInternal] = useState<NekoState>(initialState);
  const [face, setFace] = useState<NekoFace>(stateToFace[initialState]);
  
  // 口パク用のインターバルRef
  const talkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // 自動復帰用のタイムアウトRef
  const autoResetRef = useRef<NodeJS.Timeout | null>(null);

  // クリーンアップ関数
  const clearTimers = useCallback(() => {
    if (talkIntervalRef.current) {
      clearInterval(talkIntervalRef.current);
      talkIntervalRef.current = null;
    }
    if (autoResetRef.current) {
      clearTimeout(autoResetRef.current);
      autoResetRef.current = null;
    }
  }, []);

  // 状態変更（タイマーリセット付き）
  const setState = useCallback((newState: NekoState) => {
    clearTimers();
    setStateInternal(newState);
    
    // speaking状態の場合は口パクを開始
    if (newState === 'speaking' || newState === 'explaining') {
      let talkIndex = 0;
      talkIntervalRef.current = setInterval(() => {
        setFace(talkFaces[talkIndex % talkFaces.length]);
        talkIndex++;
      }, talkInterval);
    } else {
      setFace(stateToFace[newState]);
    }
  }, [clearTimers, talkInterval]);

  // アイドルに戻す
  const goIdle = useCallback(() => {
    setState('idle');
  }, [setState]);

  // 思考開始
  const startThinking = useCallback(() => {
    setState('thinking');
  }, [setState]);

  // 話し始める（durationミリ秒後に自動でidleに戻る）
  const startSpeaking = useCallback((duration?: number) => {
    setState('speaking');
    if (duration) {
      autoResetRef.current = setTimeout(() => {
        goIdle();
      }, duration);
    }
  }, [setState, goIdle]);

  // 成功アニメーション
  const celebrate = useCallback((duration = 2000) => {
    setState('success');
    autoResetRef.current = setTimeout(() => {
      goIdle();
    }, duration);
  }, [setState, goIdle]);

  // エラー表示
  const showError = useCallback((duration = 3000) => {
    setState('error');
    autoResetRef.current = setTimeout(() => {
      goIdle();
    }, duration);
  }, [setState, goIdle]);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    state,
    face,
    setState,
    goIdle,
    startThinking,
    startSpeaking,
    celebrate,
    showError,
  };
}
