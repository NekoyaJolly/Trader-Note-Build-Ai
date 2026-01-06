'use client';

import { motion, AnimatePresence, type Variants } from 'framer-motion';
import Image from 'next/image';
import { useNekoCharacter } from '@/hooks/useNekoCharacter';
import type { NekoProps, NekoState, NekoFace, BubblePosition } from '@/types/neko';
import { cn } from '@/lib/utils';

/** パーツ画像のパス */
const NEKO_ASSETS = '/characters/neko';

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

/** パーツのアニメーション定義 */
const earAnimation: Variants = {
  idle: {
    rotate: [0, 5, 0, -5, 0],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'easeInOut' as const,
    },
  },
  listening: {
    rotate: -10,
    transition: { type: 'spring', stiffness: 300 },
  },
  thinking: {
    rotate: 15,
    transition: { type: 'spring', stiffness: 200 },
  },
  speaking: {
    rotate: [0, 3, 0, -3, 0],
    transition: {
      duration: 0.5,
      repeat: Infinity,
    },
  },
  explaining: {
    rotate: [0, 5, 0],
    transition: {
      duration: 0.8,
      repeat: Infinity,
    },
  },
  success: {
    rotate: [0, 10, 0, -10, 0],
    transition: {
      duration: 0.3,
      repeat: 3,
    },
  },
  error: {
    rotate: 20,
    transition: { type: 'spring', stiffness: 100 },
  },
};

const tailAnimation: Variants = {
  idle: {
    rotate: [0, 10, 0, -10, 0],
    transition: {
      duration: 3,
      repeat: Infinity,
      ease: 'easeInOut' as const,
    },
  },
  listening: {
    rotate: [0, 5, 0],
    transition: {
      duration: 1,
      repeat: Infinity,
    },
  },
  thinking: {
    rotate: 0,
    transition: { duration: 0.3 },
  },
  speaking: {
    rotate: [0, 15, 0, -15, 0],
    transition: {
      duration: 0.8,
      repeat: Infinity,
    },
  },
  explaining: {
    rotate: [0, 20, 0, -20, 0],
    transition: {
      duration: 1,
      repeat: Infinity,
    },
  },
  success: {
    rotate: [0, 30, 0, -30, 0],
    transition: {
      duration: 0.4,
      repeat: 5,
    },
  },
  error: {
    rotate: -5,
    transition: { duration: 0.5 },
  },
} as const;

const bodyAnimation: Variants = {
  idle: {
    y: [0, -2, 0],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'easeInOut' as const,
    },
  },
  listening: {
    y: 0,
    scale: 1.02,
    transition: { type: 'spring', stiffness: 300 },
  },
  thinking: {
    y: [0, -3, 0],
    transition: {
      duration: 1.5,
      repeat: Infinity,
    },
  },
  speaking: {
    y: [0, -2, 0],
    transition: {
      duration: 0.5,
      repeat: Infinity,
    },
  },
  explaining: {
    y: [0, -3, 0],
    transition: {
      duration: 0.8,
      repeat: Infinity,
    },
  },
  success: {
    y: [0, -15, 0],
    scale: [1, 1.1, 1],
    transition: {
      duration: 0.5,
      repeat: 2,
    },
  },
  error: {
    y: 0,
    scale: 0.95,
    transition: { duration: 0.3 },
  },
};

const headphonesAnimation: Variants = {
  idle: {
    opacity: 1,
  },
  listening: {
    opacity: 1,
  },
  thinking: {
    opacity: [1, 0.5, 1],
    filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)'],
    transition: {
      duration: 1,
      repeat: Infinity,
    },
  },
  speaking: {
    opacity: 1,
  },
  explaining: {
    opacity: 1,
  },
  success: {
    opacity: 1,
    filter: 'brightness(1.3)',
  },
  error: {
    opacity: 0.7,
  },
};

interface SpeechBubbleProps {
  message: string;
  position?: BubblePosition;
}

/** 吹き出しコンポーネント */
function SpeechBubble({ message, position = 'left' }: SpeechBubbleProps) {
  const positionClasses = {
    left: 'right-full mr-3 -translate-y-1/2 top-1/4',
    right: 'left-full ml-3 -translate-y-1/2 top-1/4',
    top: 'bottom-full mb-3 left-1/2 -translate-x-1/2',
  };

  const tailClasses = {
    left: 'right-0 top-1/2 -translate-y-1/2 translate-x-full border-l-slate-800 border-t-transparent border-b-transparent border-r-transparent',
    right: 'left-0 top-1/2 -translate-y-1/2 -translate-x-full border-r-slate-800 border-t-transparent border-b-transparent border-l-transparent',
    top: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-t-slate-800 border-l-transparent border-r-transparent border-b-transparent',
  };

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className={cn(
            'absolute z-50 max-w-[200px] rounded-lg bg-slate-800 px-3 py-2 text-sm text-white shadow-lg',
            positionClasses[position]
          )}
        >
          {/* 吹き出しの尻尾 */}
          <div
            className={cn(
              'absolute h-0 w-0 border-8',
              tailClasses[position]
            )}
          />
          <p className="whitespace-pre-wrap">{message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Nekoキャラクターコンポーネント
 * パーツをレイヤー合成してアニメーションさせる
 */
export function Neko({
  state = 'idle',
  size = 150,
  message,
  bubblePosition = 'left',
  onClick,
  className,
}: NekoProps) {
  const face = stateToFace[state];

  return (
    <div
      className={cn('relative cursor-pointer select-none', className)}
      style={{ width: size, height: size * 1.4 }}
      onClick={onClick}
    >
      {/* 吹き出し */}
      <SpeechBubble message={message ?? ''} position={bubblePosition} />

      {/* キャラクター本体 */}
      <motion.div
        className="relative h-full w-full"
        variants={bodyAnimation}
        animate={state}
      >
        {/* 尻尾（最背面） - 体の右後ろから出る */}
        <motion.div
          className="absolute"
          style={{
            bottom: '8%',
            right: '-5%',
            width: size * 0.5,
            height: size * 0.35,
            transformOrigin: 'left center',
          }}
          variants={tailAnimation}
          animate={state}
        >
          <Image
            src={`${NEKO_ASSETS}/tail.png`}
            alt="tail"
            fill
            className="object-contain"
            priority
          />
        </motion.div>

        {/* 体 - 中央下部 */}
        <div
          className="absolute"
          style={{
            bottom: '0%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: size * 0.75,
            height: size * 0.85,
          }}
        >
          <Image
            src={`${NEKO_ASSETS}/body.png`}
            alt="body"
            fill
            className="object-contain object-bottom"
            priority
          />
        </div>

        {/* 左腕 - 体の左側 */}
        <motion.div
          className="absolute"
          style={{
            bottom: '18%',
            left: '8%',
            width: size * 0.28,
            height: size * 0.25,
          }}
          animate={{
            rotate: state === 'explaining' ? [0, -10, 0] : 0,
            transition: { duration: 0.8, repeat: state === 'explaining' ? Infinity : 0 },
          }}
        >
          <Image
            src={`${NEKO_ASSETS}/arm-left.png`}
            alt="left arm"
            fill
            className="object-contain"
          />
        </motion.div>

        {/* 右腕 - 体の右側 */}
        <motion.div
          className="absolute"
          style={{
            bottom: '18%',
            right: '8%',
            width: size * 0.28,
            height: size * 0.25,
          }}
          animate={{
            rotate: state === 'speaking' ? [0, 10, 0] : 0,
            transition: { duration: 0.5, repeat: state === 'speaking' ? Infinity : 0 },
          }}
        >
          <Image
            src={`${NEKO_ASSETS}/arm-right.png`}
            alt="right arm"
            fill
            className="object-contain"
          />
        </motion.div>

        {/* タブレット - 右腕の先 */}
        <motion.div
          className="absolute"
          style={{
            bottom: '22%',
            right: '-8%',
            width: size * 0.38,
            height: size * 0.32,
          }}
          animate={{
            rotate: state === 'speaking' || state === 'explaining' ? [0, 5, 0] : 0,
            y: state === 'speaking' ? [-2, 2, -2] : 0,
            transition: { duration: 0.8, repeat: Infinity },
          }}
        >
          <Image
            src={`${NEKO_ASSETS}/tablet.png`}
            alt="tablet"
            fill
            className="object-contain"
          />
        </motion.div>

        {/* 顔 - 体の上部に重なる */}
        <div
          className="absolute"
          style={{
            top: '8%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: size * 0.7,
            height: size * 0.55,
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={face}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="relative h-full w-full"
            >
              <Image
                src={`${NEKO_ASSETS}/face-${face}.png`}
                alt="face"
                fill
                className="object-contain"
                priority
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 左耳 - 顔の左上 */}
        <motion.div
          className="absolute"
          style={{
            top: '2%',
            left: '15%',
            width: size * 0.22,
            height: size * 0.2,
            transformOrigin: 'bottom center',
          }}
          variants={earAnimation}
          animate={state}
        >
          <Image
            src={`${NEKO_ASSETS}/ear-left.png`}
            alt="left ear"
            fill
            className="object-contain"
          />
        </motion.div>

        {/* 右耳 - 顔の右上 */}
        <motion.div
          className="absolute"
          style={{
            top: '2%',
            right: '15%',
            width: size * 0.22,
            height: size * 0.2,
            transformOrigin: 'bottom center',
          }}
          variants={earAnimation}
          animate={state}
        >
          <Image
            src={`${NEKO_ASSETS}/ear-right.png`}
            alt="right ear"
            fill
            className="object-contain"
          />
        </motion.div>

        {/* ヘッドフォン - 顔に重なる */}
        <motion.div
          className="absolute"
          style={{
            top: '12%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: size * 0.65,
            height: size * 0.3,
          }}
          variants={headphonesAnimation}
          animate={state}
        >
          <Image
            src={`${NEKO_ASSETS}/headphones.png`}
            alt="headphones"
            fill
            className="object-contain"
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

export default Neko;
