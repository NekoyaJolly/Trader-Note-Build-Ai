/**
 * Vitest 共通セットアップ (Phase 4d Step 2)
 *
 * - @testing-library/jest-dom のカスタムマッチャ（toBeInTheDocument 等）を
 *   Vitest の expect に追加する
 * - React Testing Library のクリーンアップは vitest の `globals: true` 設定下では
 *   自動で走る（afterEach 不要）
 */

import "@testing-library/jest-dom/vitest";
