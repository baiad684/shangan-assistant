/**
 * 服务端鉴权与统一 HTTP 契约（ARCHITECTURE.md §4）
 *
 * 设计要点：
 *   - 路由处理器「极薄」：解析 → 校验 → 调 service → 序列化。业务判断不进这里。
 *   - 所有错误走 ApiError，由 route() 统一转成 { ok:false, error:{code,message} }。
 *   - 客户端只按 code 分支，从不解析 message 文案。
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { z } from 'zod';
import type { ErrorCode } from '../types';
import { validate } from '../validation';
import { COOKIE_NAME, verifySession } from './jwt';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  unauthorized: () => new ApiError('UNAUTHORIZED', '未登录或登录已过期', 401),
  onboardingRequired: () => new ApiError('ONBOARDING_REQUIRED', '尚未完成首次引导', 409),
  notFound: (what = '资源') => new ApiError('NOT_FOUND', `${what}不存在`, 404),
  validation: (message: string, details?: unknown) =>
    new ApiError('VALIDATION_FAILED', message, 422, details),
  conflict: (message: string, details?: unknown) => new ApiError('CONFLICT', message, 409, details),
  rateLimited: (message: string, details?: unknown) =>
    new ApiError('RATE_LIMITED', message, 429, details),
  internal: (message = '服务器内部错误') => new ApiError('INTERNAL', message, 500),
};

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_FAILED', message: '请求体不是合法 JSON' } },
      { status: 422 },
    );
  }
  console.error('[api] 未预期错误', err);
  const message = process.env.NODE_ENV === 'production' ? '服务器内部错误' : String(err);
  return NextResponse.json({ ok: false, error: { code: 'INTERNAL', message } }, { status: 500 });
}

/** 包装路由处理器：统一异常 → JSON。 */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<NextResponse>) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** 当前请求是否已登录 */
export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return verifySession(store.get(COOKIE_NAME)?.value);
}

/** 守卫：未登录直接抛 401 */
export async function requireSession(): Promise<void> {
  if (!(await hasSession())) throw errors.unauthorized();
}

/** 解析并校验 JSON 请求体 */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw errors.validation('请求体不是合法 JSON');
  }
}

/** 查询参数取值 */
export function searchParam(req: Request, key: string): string | null {
  return new URL(req.url).searchParams.get(key);
}

/**
 * 校验请求体。把 validation.ts 的字段级错误转成统一的 422 ApiError。
 * 客户端拿到的 details 是 [{path, message}]，可直接映射到表单字段。
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = validate(schema, body);
  if (!result.success) {
    const first = result.issues[0];
    throw errors.validation(first ? `${first.path}: ${first.message}` : '参数校验失败', {
      issues: result.issues,
    });
  }
  return result.data;
}

/** 解析 + 校验 JSON 请求体 */
export async function readValidatedBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  return parseBody(schema, await readJsonBody(req));
}

/** 解析路径参数中的数字 id */
export function numericParam(value: string | undefined, what = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw errors.validation(`${what} 不合法`);
  return n;
}
