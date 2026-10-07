/**
 * 请求体校验（zod）
 *
 * 路由处理器只做「解析 → 校验 → 调 service」，校验规则集中在这里，
 * 类型由 z.infer 反推，前后端共享同一份定义，不会出现两边字段名不一致。
 */
import { z } from 'zod';
import { FOCUS_MINUTES_MAX, FOCUS_MINUTES_MIN, FOCUS_SOURCES } from './types';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #RRGGBB 格式');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期需为 YYYY-MM-DD 格式');
const isoDateTime = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), '时间格式不合法');

export const loginSchema = z.object({
  password: z.string().min(1, '请输入密码').max(200),
});

const pomodoroSchema = z.object({
  focusMinutes: z.number().int().min(FOCUS_MINUTES_MIN).max(FOCUS_MINUTES_MAX),
  shortBreakMinutes: z.number().int().min(1).max(60),
  longBreakMinutes: z.number().int().min(1).max(120),
  longBreakEvery: z.number().int().min(1).max(12),
  longBreakEnabled: z.boolean(),
});

export const onboardingSchema = z.object({
  password: z.string().min(4, '密码至少 4 位').max(200),
  examDate: dateStr,
  dailyGoalMinutes: z.number().int().min(30).max(20 * 60),
  subjects: z
    .array(z.object({ name: z.string().min(1).max(20), color: hexColor }))
    .min(1, '至少保留一个科目')
    .max(20),
  weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const subjectCreateSchema = z.object({
  name: z.string().min(1, '科目名不能为空').max(20),
  color: hexColor,
});

export const subjectPatchSchema = z
  .object({
    name: z.string().min(1).max(20).optional(),
    color: hexColor.optional(),
    sortOrder: z.number().int().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, '没有需要更新的字段');

export const subjectReorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export const itemCreateSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200),
  subjectId: z.number().int().positive().nullable().optional(),
  note: z.string().max(200).nullable().optional(),
  date: dateStr.optional(),
});

export const focusCreateSchema = z.object({
  clientId: z.string().min(8).max(64).optional(),
  subjectId: z.number().int().positive(),
  startedAt: isoDateTime,
  focusMinutes: z.number().int().min(1).max(24 * 60),
  plannedMinutes: z.number().int().min(1).max(24 * 60).optional(),
  pausedSeconds: z.number().int().min(0).max(24 * 3600).optional(),
  source: z.enum(FOCUS_SOURCES as unknown as [string, ...string[]]),
  note: z.string().max(200).nullable().optional(),
  localDate: dateStr.optional(),
});

export const settingsPatchSchema = z
  .object({
    examDate: dateStr.optional(),
    dailyGoalMinutes: z.number().int().min(30).max(20 * 60).optional(),
    weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    pomodoro: pomodoroSchema.partial().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, '没有需要更新的字段');

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4, '新密码至少 4 位').max(200),
});

export const backupImportSchema = z.object({
  payload: z.unknown(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type FocusCreateInput = z.infer<typeof focusCreateSchema>;

export interface Issue {
  path: string;
  message: string;
}

/**
 * 校验并返回字段级错误。刻意不抛 ApiError ——
 * 这个模块要能被客户端组件直接 import 做表单预校验，
 * 所以不引入任何服务端依赖。转成 ApiError 的动作在 server/http.ts 的 parseBody 里做。
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): { success: true; data: z.infer<T> } | { success: false; issues: Issue[] } {
  const result = schema.safeParse(value);
  if (result.success) return { success: true, data: result.data };

  return {
    success: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  };
}
