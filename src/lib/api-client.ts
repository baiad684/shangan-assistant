'use client';

/**
 * 浏览器侧 API 封装。
 *
 * 只认 { ok, data } / { ok:false, error:{code} } 这一份契约，
 * 组件里因此永远不需要写 res.status === 401 这种判断。
 */
import type { ApiResult, ErrorCode } from './types';

export class ApiClientError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  get isAuthError() {
    return this.code === 'UNAUTHORIZED';
  }

  /** 422 时把字段级错误取出来，供表单高亮 */
  get issues(): Array<{ path: string; message: string }> {
    const d = this.details as { issues?: Array<{ path: string; message: string }> } | undefined;
    return d?.issues ?? [];
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiClientError('INTERNAL', '网络不可用，请检查连接后重试', 0);
  }

  if (res.status === 204) return undefined as T;

  let payload: ApiResult<T> | null = null;
  try {
    payload = (await res.json()) as ApiResult<T>;
  } catch {
    throw new ApiClientError('INTERNAL', `服务器返回了非 JSON 响应（${res.status}）`, res.status);
  }

  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new ApiClientError('INTERNAL', '响应格式不符合约定', res.status);
  }

  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, payload.error.message, res.status, payload.error.details);
  }

  // 401 时把页面送回登录，避免用户对着一个坏掉的界面点来点去
  return payload.data;
}

const jsonBody = (body: unknown) => ({ body: JSON.stringify(body) });

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body !== undefined ? jsonBody(body) : {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', ...(body !== undefined ? jsonBody(body) : {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', ...(body !== undefined ? jsonBody(body) : {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** 把任意异常转成可直接展示的文案 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return '出了点问题，请重试';
}

/** 是否属于「网络不通」类错误（离线队列据此决定是否保留任务） */
export function isOffline(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 0;
}

/**
 * 提交失败的去向（离线补交队列据此决定「保留还是丢弃」）。
 *
 * - deferred：现在办不成、之后能办成 —— 断网 / 会话过期 / 被限流
 * - retry：服务端临时故障（5xx），可重试
 * - fatal：服务端明确拒绝（校验失败等），重试无意义
 *
 * 特别注意 UNAUTHORIZED 属于 deferred 而非 fatal：
 * 会话过期时若直接丢弃，用户刚专注完的记录会凭空消失（真实踩过）。
 */
export type SubmissionFailure = 'deferred' | 'retry' | 'fatal';

export function classifySubmissionError(err: unknown): SubmissionFailure {
  if (isOffline(err)) return 'deferred';

  if (err instanceof ApiClientError) {
    if (err.code === 'UNAUTHORIZED') return 'deferred';
    if (err.code === 'RATE_LIMITED') return 'deferred';
    if (err.code === 'INTERNAL' || err.status >= 500) return 'retry';
    // VALIDATION_FAILED / NOT_FOUND / CONFLICT / ONBOARDING_REQUIRED
    return 'fatal';
  }

  // 非接口层异常（例如回调里抛错）：保守当作可重试，宁可留着也别丢数据
  return 'retry';
}
