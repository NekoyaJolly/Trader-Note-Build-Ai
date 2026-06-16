/** 通知粒度設定の数値入力で共有する範囲とエラーメッセージ */
export const NOTIFICATION_PREFERENCE_NUMERIC_RULES = {
  cooldownMinutes: {
    min: 1,
    max: 10080,
    integerMessage: '整数で指定してください',
    minMessage: '1分以上で指定してください',
    maxMessage: '1週間以内で指定してください',
  },
  maxPerDay: {
    min: 1,
    max: 1000,
    integerMessage: '整数で指定してください',
    minMessage: '1件以上で指定してください',
    maxMessage: '1000件以下で指定してください',
  },
} as const;

type NotificationPreferenceNumericRule = {
  /** 許可する最小値 */
  readonly min: number;
  /** 許可する最大値 */
  readonly max: number;
  /** 整数ではない場合に表示するメッセージ */
  readonly integerMessage: string;
  /** 最小値を下回る場合に表示するメッセージ */
  readonly minMessage: string;
  /** 最大値を上回る場合に表示するメッセージ */
  readonly maxMessage: string;
};

/** null は「上位スコープの設定へフォールバック」を意味するため正常値として扱う */
function validateNullableIntegerRange(
  value: number | null,
  rule: NotificationPreferenceNumericRule
): string | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value)) {
    return rule.integerMessage;
  }
  if (value < rule.min) {
    return rule.minMessage;
  }
  if (value > rule.max) {
    return rule.maxMessage;
  }
  return null;
}

/** 通知クールダウン分数の入力エラーを返す */
export function validateNotificationPreferenceCooldownMinutes(value: number | null): string | null {
  return validateNullableIntegerRange(value, NOTIFICATION_PREFERENCE_NUMERIC_RULES.cooldownMinutes);
}

/** 24時間あたり通知上限の入力エラーを返す */
export function validateNotificationPreferenceMaxPerDay(value: number | null): string | null {
  return validateNullableIntegerRange(value, NOTIFICATION_PREFERENCE_NUMERIC_RULES.maxPerDay);
}
