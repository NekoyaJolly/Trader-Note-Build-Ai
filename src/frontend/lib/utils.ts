import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind クラスを安全にマージするユーティリティ
 * shadcn/ui コンポーネントの推奨パターン。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
