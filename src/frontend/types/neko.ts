/**
 * Neko キャラクター関連の型定義
 * AIアシスタントの状態とアニメーションを管理
 */

/** Nekoの状態（AIの思考状態と連動） */
export type NekoState =
  | 'idle'       // 待機状態 - 耳ピクピク、目パチ
  | 'listening'  // 聞き取り中 - 耳を立てる
  | 'thinking'   // 思考中 - ヘッドフォン光る、目を閉じる
  | 'speaking'   // 話し中 - 口パク、タブレット掲げる
  | 'explaining' // 説明中 - 指差し、地球儀回す
  | 'success'    // 成功 - 大笑い、軽くジャンプ
  | 'error';     // エラー - 困り顔、耳を伏せる

/** 表情の種類（face-*.pngに対応） */
export type NekoFace =
  | 'normal'
  | 'smile'
  | 'laugh'
  | 'big-laugh'
  | 'talk-1'
  | 'talk-2'
  | 'worried'
  | 'thinking';

/** 状態ごとの表情マッピング */
export const STATE_TO_FACE: Record<NekoState, NekoFace> = {
  idle: 'normal',
  listening: 'smile',
  thinking: 'thinking',
  speaking: 'talk-1',
  explaining: 'talk-2',
  success: 'big-laugh',
  error: 'worried',
};

/** 吹き出しの位置 */
export type BubblePosition = 'left' | 'right' | 'top';

/** Nekoコンポーネントのprops */
export interface NekoProps {
  /** 現在の状態 */
  state?: NekoState;
  /** キャラクターのサイズ（px） */
  size?: number;
  /** 吹き出しに表示するメッセージ */
  message?: string;
  /** 吹き出しの位置 */
  bubblePosition?: BubblePosition;
  /** クリック時のコールバック */
  onClick?: () => void;
  /** 追加のクラス名 */
  className?: string;
}

/** 吹き出しのprops */
export interface SpeechBubbleProps {
  /** 表示するメッセージ */
  message: string;
  /** 位置 */
  position?: BubblePosition;
  /** タイピングエフェクトを有効化 */
  typing?: boolean;
  /** タイピング速度（ms/文字） */
  typingSpeed?: number;
}

/** チュートリアルステップの定義 */
export interface TutorialStep {
  /** ステップID */
  id: string;
  /** 対象ページ */
  page?: string;
  /** Nekoのセリフ */
  message: string;
  /** Nekoの状態 */
  state: NekoState;
  /** 次へ進む条件（イベント名など） */
  trigger?: string;
  /** ハイライトする要素のセレクタ */
  highlightSelector?: string;
}
