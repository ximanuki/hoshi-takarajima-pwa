/**
 * Errors carry both a Japanese and an English message so that the MCP client
 * (and the human reading the transcript) gets an actionable explanation in
 * either language.
 */
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'OUT_OF_RANGE'
  | 'NOT_FOUND'
  | 'UPSTREAM_HTTP'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_NETWORK'
  | 'UPSTREAM_BAD_RESPONSE'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export interface ChiriinErrorInit {
  code: ErrorCode;
  ja: string;
  en: string;
  hint?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class ChiriinError extends Error {
  readonly code: ErrorCode;
  readonly messageJa: string;
  readonly messageEn: string;
  readonly hint: string | undefined;
  readonly retryable: boolean;

  constructor(init: ChiriinErrorInit) {
    super(`${init.ja} / ${init.en}`, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ChiriinError';
    this.code = init.code;
    this.messageJa = init.ja;
    this.messageEn = init.en;
    this.hint = init.hint;
    this.retryable = init.retryable ?? false;
  }

  /** Text shown to the MCP client when a tool fails. */
  toUserText(): string {
    const lines = [`エラー [${this.code}]: ${this.messageJa}`, `Error [${this.code}]: ${this.messageEn}`];
    if (this.hint) lines.push(`ヒント: ${this.hint}`);
    return lines.join('\n');
  }
}

export function toChiriinError(error: unknown): ChiriinError {
  if (error instanceof ChiriinError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ChiriinError({
    code: 'INTERNAL',
    ja: `予期しないエラーが発生しました: ${detail}`,
    en: `Unexpected error: ${detail}`,
    cause: error,
  });
}
