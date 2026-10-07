import { NextResponse } from 'next/server';
import { errors, readValidatedBody, route } from '@/lib/server/http';
import { changePassword, hasPassword } from '@/lib/server/auth';
import { markOnboarded, updateSettings, unset } from '@/lib/server/settings';
import { seedSubjects, reorderSubjects, listSubjects, createSubject } from '@/lib/server/data';
import { prisma } from '@/lib/server/db';
import { COOKIE_NAME, COOKIE_OPTIONS, signSession } from '@/lib/server/jwt';
import { onboardingSchema } from '@/lib/validation';
import { PRESET_SUBJECTS } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding
 *
 * 首次引导提交：设密码 → 考试日期 → 科目 → 每日目标，一次性完成并直接登入。
 * 只在「尚未设置密码」时允许调用，避免被当成免登录的重置后门。
 */
export const POST = route(async (req: Request) => {
  if (await hasPassword()) {
    throw errors.conflict('已完成初始化，如需重置请使用 npm run reset-password');
  }

  const body = await readValidatedBody(req, onboardingSchema);

  await changePassword(body.password);

  // 科目：先种预置（若库为空），再按用户勾选结果对齐 —— 用户可能改名、删减、新增
  const seeded = await seedSubjects(PRESET_SUBJECTS);
  const chosen = await reconcileSubjects(
    seeded.map((s) => s.id),
    body.subjects,
  );

  await updateSettings({
    examDate: body.examDate,
    dailyGoalMinutes: body.dailyGoalMinutes,
    ...(body.weekStart !== undefined ? { weekStart: body.weekStart } : {}),
  });

  await reorderSubjects(chosen);
  await markOnboarded();
  await unset('authGuard').catch(() => undefined);

  const token = await signSession();
  const res = NextResponse.json({
    ok: true,
    data: { onboarded: true, subjects: await listSubjects() },
  });
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
});

/**
 * 把用户提交的科目列表落到库里，返回最终排序后的 id 列表。
 * 采用「改名复用 + 新增补齐 + 多余归档」的策略，而不是清空重建 ——
 * 否则重跑引导会把已有专注记录的 subjectId 变成脏引用。
 */
async function reconcileSubjects(
  seededIds: number[],
  desired: Array<{ name: string; color: string }>,
): Promise<number[]> {
  const resultIds: number[] = [];
  const usedIds = new Set<number>();

  for (let i = 0; i < desired.length; i++) {
    const want = desired[i].name.trim();
    const existing =
      (seededIds[i] !== undefined ? await prisma.subject.findUnique({ where: { id: seededIds[i] } }) : null) ??
      (await prisma.subject.findFirst({ where: { name: want } }));

    if (existing) {
      usedIds.add(existing.id);
      await prisma.subject.update({
        where: { id: existing.id },
        data: { name: want, color: desired[i].color, archivedAt: null, sortOrder: i },
      });
      resultIds.push(existing.id);
    } else {
      const created = await createSubject(want, desired[i].color);
      usedIds.add(created.id);
      resultIds.push(created.id);
    }
  }

  // 未被选中的预置科目归档，而不是删除，保证历史统计不丢
  await prisma.subject.updateMany({
    where: { id: { notIn: [...usedIds] }, archivedAt: null },
    data: { archivedAt: new Date() },
  });

  return resultIds;
}
