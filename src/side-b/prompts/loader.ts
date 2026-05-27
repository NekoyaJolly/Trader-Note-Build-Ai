/**
 * プロンプトローダー
 *
 * 目的: src/side-b/prompts/ 配下のマークダウンファイルを
 *       システムプロンプトとして読み込み、マクロ展開する。
 *
 * 設計思想:
 * - エージェントのシステムプロンプトはコードにハードコードせず外部ファイル化。
 * - 将来の進化的探索でプロンプト自体を変異対象にできるようにするため。
 * - マクロ ({{CORE_TRADING_RULES}} 等) は呼び出し側で注入する。
 */

import fs from 'fs';
import path from 'path';
import { EVOLUTION_TARGETS_PROMPT_TEXT } from '../evolution/evolutionTargets';

const PROMPTS_DIR = __dirname;

/**
 * Phase 6.7a: グローバルプロンプト識別子(agentName / ファイル名共通)。
 *
 * - ファイル: `src/side-b/prompts/__global__.md`
 * - Registry: `agentName = '__global__'` で active 管理
 *
 * 単一ソースはここ。PromptRegistry は re-export するだけ(循環 import 回避のため)。
 */
export const GLOBAL_AGENT_NAME = '__global__';

/**
 * 専門家エージェント用共通テンプレの予約名（Registry agentName）。
 * Phase 6.7c: 未投入時も識別子として使用。
 */
export const SPECIALIST_COMMON_AGENT_NAME = '__specialist_common__';

/**
 * プロンプト内の {{KEY}} プレースホルダーを展開するための辞書。
 * 必要に応じて新しいキーを追加していく。
 */
export interface PromptMacros {
    CORE_TRADING_RULES?: string;
    MACRO_ENVIRONMENT_RULES?: string;
    MTF_ANALYSIS_RULES?: string;
    [key: string]: string | undefined;
}

/**
 * 指定したプロンプトファイルを読み込み、マクロ展開した文字列を返す。
 *
 * @param name 拡張子なしのファイル名 (例: 'strategy_thinker')
 * @param macros プレースホルダー置換用の辞書 (省略可)
 * @returns 展開済みのプロンプト文字列
 * @throws ファイルが存在しない場合
 */
export function loadPrompt(name: string, macros?: PromptMacros): string {
    const filePath = path.join(PROMPTS_DIR, `${name}.md`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Prompt file not found: ${name} (expected at ${filePath})`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return expandMacros(content, macros);
}

/**
 * 任意の文字列に対してマクロプレースホルダー `{{KEY}}` を展開する。
 *
 * Phase 6.7a: Registry 経由で取得したプロンプト本文など、ファイル読み込みを経ない
 * コンテンツにもマクロ展開を適用できるよう、展開ロジックを切り出した。
 *
 * - `macros` 未指定 or 空 → content をそのまま返す
 * - 値が undefined のキーは空文字列に置換(プレースホルダーを残さない)
 * - 展開はキー順の決定論的処理(依存しない前提だが、副次効果として再現性あり)
 */
export function expandMacros(content: string, macros?: PromptMacros): string {
    if (!macros) return content;
    let out = content;
    for (const [key, value] of Object.entries(macros)) {
        const placeholder = `{{${key}}}`;
        out = out.split(placeholder).join(value ?? '');
    }
    return out;
}

/**
 * Phase 6.7a: グローバル + エージェント固有プロンプトをファイルから合成する(C 案)。
 *
 * 用途: Registry 未接続エージェントの fallback 経路、もしくは Registry 未投入の
 * ローカル環境/テストで使う。通常の実運用は `PromptRegistry.getCompositeActive`
 * を経由すること(Registry 側の experimental / active 使い分けと整合する)。
 *
 * 挙動:
 *   - `__global__.md` が存在する → `{global content}\n\n{agent content}` を返す
 *   - 存在しない → `{agent content}` 単独で返す(警告ログ出力、後方互換)
 *   - agent ファイルが存在しない → 従来通り例外
 *   - 両 content に同じ `macros` を展開
 */
export function loadPromptWithGlobal(name: string, macros?: PromptMacros): string {
    const localContent = loadPrompt(name, macros);
    const globalPath = path.join(PROMPTS_DIR, `${GLOBAL_AGENT_NAME}.md`);
    if (!fs.existsSync(globalPath)) {
        console.warn(
            `[loadPromptWithGlobal] ${GLOBAL_AGENT_NAME}.md が見つかりません。agent=${name} 単独で返します`,
        );
        return localContent;
    }
    const globalRaw = fs.readFileSync(globalPath, 'utf-8');
    const globalExpanded = expandMacros(globalRaw, macros);
    return `${globalExpanded}\n\n${EVOLUTION_TARGETS_PROMPT_TEXT}\n\n${localContent}`;
}

/**
 * Phase 6.7c: 専門家エージェント用に
 * `__global__` + `__specialist_common__` + 専門家固有プロンプトをファイルから合成する。
 *
 * Registry 未投入の開発環境でも専門家3本が同じ3層構造で動くための fallback。
 */
export function loadSpecialistPromptWithGlobalAndCommon(
    name: string,
    macros?: PromptMacros,
): string {
    const localContent = loadPrompt(name, macros);
    const parts: string[] = [];
    for (const reservedName of [GLOBAL_AGENT_NAME, SPECIALIST_COMMON_AGENT_NAME]) {
        const filePath = path.join(PROMPTS_DIR, `${reservedName}.md`);
        if (!fs.existsSync(filePath)) {
            console.warn(
                `[loadSpecialistPromptWithGlobalAndCommon] ${reservedName}.md が見つかりません。agent=${name}`,
            );
            continue;
        }
        parts.push(expandMacros(fs.readFileSync(filePath, 'utf-8'), macros));
        if (reservedName === GLOBAL_AGENT_NAME) {
            parts.push(EVOLUTION_TARGETS_PROMPT_TEXT);
        }
    }
    parts.push(localContent);
    return parts.join('\n\n');
}

/**
 * Phase 6.7a: Registry から取得済みの agent content に、ファイルから読んだ
 * `__global__` を前置する helper。
 *
 * 用途: Registry 接続済みエージェント(HypothesisGenerator、3 Specialists 等)が
 * variantSelector で選んだ experimental/active の content に、グローバルルールを
 * 合成するとき。PromptRegistry.getCompositeActive とは別経路で、Registry の
 * `__global__` active が未投入でもファイルから読める fallback を優先する。
 *
 * ただし Registry に `__global__` active がある場合はそちらを優先したいので、
 * 基本的には `PromptRegistry.getCompositeActive` を使うのが正規ルート。
 * この関数は「variant selection 済みの content を既に手元に持っている」ケース
 * 向けのユーティリティ。
 */
export function prependGlobalPromptFromFile(
    localContent: string,
    macros?: PromptMacros,
): string {
    const globalPath = path.join(PROMPTS_DIR, `${GLOBAL_AGENT_NAME}.md`);
    if (!fs.existsSync(globalPath)) {
        return localContent;
    }
    const globalRaw = fs.readFileSync(globalPath, 'utf-8');
    const globalExpanded = expandMacros(globalRaw, macros);
    const localExpanded = expandMacros(localContent, macros);
    return `${globalExpanded}\n\n${EVOLUTION_TARGETS_PROMPT_TEXT}\n\n${localExpanded}`;
}
