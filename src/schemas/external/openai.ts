/**
 * 外部API Zodスキーマ - OpenAI
 * 
 * 目的: OpenAI APIのレスポンスを安全にパースするためのスキーマ
 */

import { z } from 'zod';

// ========================================
// Chat Completions API
// ========================================

/**
 * メッセージロール
 */
export const OpenAIRoleSchema = z.enum(['system', 'user', 'assistant', 'function', 'tool']);

export type OpenAIRole = z.infer<typeof OpenAIRoleSchema>;

/**
 * チャットメッセージ
 */
export const OpenAIChatMessageSchema = z.object({
  role: OpenAIRoleSchema,
  content: z.string().nullable(),
  name: z.string().optional(),
  function_call: z.object({
    name: z.string(),
    arguments: z.string(),
  }).optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })).optional(),
});

export type OpenAIChatMessage = z.infer<typeof OpenAIChatMessageSchema>;

/**
 * チャットコンプリーションの選択肢
 */
export const OpenAIChatChoiceSchema = z.object({
  index: z.number(),
  message: OpenAIChatMessageSchema,
  finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
  logprobs: z.unknown().nullable().optional(),
});

export type OpenAIChatChoice = z.infer<typeof OpenAIChatChoiceSchema>;

/**
 * 使用トークン
 */
export const OpenAIUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

export type OpenAIUsage = z.infer<typeof OpenAIUsageSchema>;

/**
 * Chat Completions レスポンス
 */
export const OpenAIChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(OpenAIChatChoiceSchema),
  usage: OpenAIUsageSchema.optional(),
  system_fingerprint: z.string().optional(),
});

export type OpenAIChatCompletionResponse = z.infer<typeof OpenAIChatCompletionResponseSchema>;

// ========================================
// Responses API (gpt-4oなど新API)
// ========================================

/**
 * Responses API の出力アイテム
 */
export const OpenAIResponseOutputItemSchema = z.object({
  type: z.enum(['message', 'function_call', 'function_call_output']),
  id: z.string().optional(),
  status: z.string().optional(),
  role: OpenAIRoleSchema.optional(),
  content: z.array(z.object({
    type: z.enum(['output_text', 'refusal']),
    text: z.string().optional(),
    annotations: z.array(z.unknown()).optional(),
  })).optional(),
});

export type OpenAIResponseOutputItem = z.infer<typeof OpenAIResponseOutputItemSchema>;

/**
 * Responses API レスポンス
 */
export const OpenAIResponsesAPISchema = z.object({
  id: z.string(),
  object: z.literal('response'),
  created_at: z.number(),
  status: z.enum(['completed', 'failed', 'in_progress', 'cancelled']),
  output: z.array(OpenAIResponseOutputItemSchema),
  output_text: z.string().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
  model: z.string().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).nullable().optional(),
});

export type OpenAIResponsesAPI = z.infer<typeof OpenAIResponsesAPISchema>;

// ========================================
// エラーレスポンス
// ========================================

/**
 * OpenAI エラー詳細
 */
export const OpenAIErrorDetailSchema = z.object({
  message: z.string(),
  type: z.string(),
  param: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export type OpenAIErrorDetail = z.infer<typeof OpenAIErrorDetailSchema>;

/**
 * OpenAI エラーレスポンス
 */
export const OpenAIErrorResponseSchema = z.object({
  error: OpenAIErrorDetailSchema,
});

export type OpenAIErrorResponse = z.infer<typeof OpenAIErrorResponseSchema>;

// ========================================
// 統合レスポンススキーマ
// ========================================

/**
 * OpenAI APIレスポンス（Chat Completions or Responses API）
 */
export const OpenAIAPIResponseSchema = z.union([
  OpenAIChatCompletionResponseSchema,
  OpenAIResponsesAPISchema,
  OpenAIErrorResponseSchema,
]);

export type OpenAIAPIResponse = z.infer<typeof OpenAIAPIResponseSchema>;

// ========================================
// ヘルパー関数
// ========================================

/**
 * OpenAIレスポンスがエラーかどうかを判定
 */
export function isOpenAIError(response: unknown): response is OpenAIErrorResponse {
  const result = OpenAIErrorResponseSchema.safeParse(response);
  return result.success;
}

/**
 * Chat Completionsレスポンスからテキストコンテンツを抽出
 */
export function extractChatContent(response: OpenAIChatCompletionResponse): string | null {
  const choice = response.choices[0];
  if (!choice) return null;
  return choice.message.content;
}

/**
 * Responses APIレスポンスからテキストコンテンツを抽出
 */
export function extractResponsesContent(response: OpenAIResponsesAPI): string | null {
  // output_textが直接ある場合
  if (response.output_text) {
    return response.output_text;
  }
  
  // outputからテキストを抽出
  for (const item of response.output) {
    if (item.content) {
      for (const content of item.content) {
        if (content.type === 'output_text' && content.text) {
          return content.text;
        }
      }
    }
  }
  
  return null;
}

/**
 * OpenAIレスポンスを安全にパースしてテキストを抽出
 */
export function parseOpenAIResponse(response: unknown): string {
  // Chat Completions形式を試行
  const chatResult = OpenAIChatCompletionResponseSchema.safeParse(response);
  if (chatResult.success) {
    const content = extractChatContent(chatResult.data);
    if (content) return content;
    throw new Error('OpenAI Chat Completions レスポンスにコンテンツがありません');
  }
  
  // Responses API形式を試行
  const responsesResult = OpenAIResponsesAPISchema.safeParse(response);
  if (responsesResult.success) {
    if (responsesResult.data.status === 'failed' && responsesResult.data.error) {
      throw new Error(`OpenAI API エラー: ${responsesResult.data.error.message}`);
    }
    const content = extractResponsesContent(responsesResult.data);
    if (content) return content;
    throw new Error('OpenAI Responses API レスポンスにコンテンツがありません');
  }
  
  // エラーレスポンスかチェック
  const errorResult = OpenAIErrorResponseSchema.safeParse(response);
  if (errorResult.success) {
    throw new Error(`OpenAI API エラー: ${errorResult.data.error.message}`);
  }
  
  throw new Error('OpenAI レスポンス形式が不明です');
}

/**
 * AIレスポンスからJSONを抽出してパース
 * マークダウンコードブロック内のJSONを抽出
 */
export function extractJSONFromAIResponse<T>(
  content: string,
  schema: z.ZodType<T>
): T {
  // ```json ... ``` ブロックを探す
  const jsonBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  
  let jsonString: string;
  
  if (jsonBlockMatch) {
    jsonString = jsonBlockMatch[1].trim();
  } else {
    // コードブロックがない場合、全体をJSONとして試行
    jsonString = content.trim();
  }
  
  // JSONをパース
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`AI出力のJSONパースに失敗: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  // Zodスキーマでバリデーション
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`AI出力のバリデーションに失敗: ${result.error.message}`);
  }
  
  return result.data;
}
