/**
 * 数据访问与服务层（ARCHITECTURE.md §2 的 L3 server 侧）
 *
 * 这是唯一 import prisma 的地方。上层（API / 页面）只调用这里的函数，
 * 拿到的是普通对象，看不到 Prisma 类型 —— 日后换 Postgres、加缓存、加多用户过滤，
 * 改动都收敛在这个文件里。
 *
 * 每个函数签名都预留了 opts.userId（当前恒为单用户 OWNER_ID，决策 D9），
 * 把「以后要多用户」从伤筋动骨的改造降级成加一层 where 条件。
 */
import { prisma } from './db';
import { dailyMinutesAll, hasEarlyBird, subjectMinutesAll, totalsAll } from './aggregates';
import {
  MANUAL_BACKFILL_DAYS,
  type AchievementDTO,
  type CompletedItemDTO,
  type FocusSessionDTO,
  type FocusSource,
  type SubjectDTO,
} from '../types';
import { addDays, diffDays, localDateOf, localMidnightUtc, todayLocalDate } from '../domain/time';
import { buildSnapshotFromDaily, type SessionLike, type SubjectLike } from '../domain/stats';
import { BADGES, newlyUnlocked } from '../domain/achievements';
import { errors } from './http';

/** 单用户占位（决策 D9） */
export const OWNER_ID = 1;

// ── 映射：Prisma 行 → 领域对象 / DTO ────────────────────────────────────

type SubjectRow = {
  id: number;
  name: string;
  color: string;
  archivedAt: Date | null;
  sortOrder: number;
};

function toSubjectDTO(row: SubjectRow): SubjectDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archivedAt !== null,
    sortOrder: row.sortOrder,
  };
}

function toSubjectLike(row: SubjectRow): SubjectLike {
  return { id: row.id, name: row.name, color: row.color, archived: row.archivedAt !== null };
}

type SessionRow = {
  id: number;
  subjectId: number;
  startedAt: Date;
  localDate: string;
  focusMinutes: number;
  plannedMinutes: number | null;
  pausedSeconds: number;
  source: string;
  note: string | null;
  subject?: { name: string; color: string } | null;
};

function toSessionDTO(row: SessionRow): FocusSessionDTO {
  return {
    id: row.id,
    subjectId: row.subjectId,
    subjectName: row.subject?.name ?? '已删除科目',
    subjectColor: row.subject?.color ?? '#94a3b8',
    startedAt: row.startedAt.toISOString(),
    localDate: row.localDate,
    focusMinutes: row.focusMinutes,
    plannedMinutes: row.plannedMinutes,
    pausedSeconds: row.pausedSeconds,
    source: row.source as FocusSource,
    note: row.note,
  };
}

// ── 科目 ──────────────────────────────────────────────────────────────

export async function listSubjects(opts: { includeArchived?: boolean } = {}): Promise<SubjectDTO[]> {
  const rows = await prisma.subject.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toSubjectDTO);
}

export async function listSubjectLikes(): Promise<SubjectLike[]> {
  const rows = await prisma.subject.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return rows.map(toSubjectLike);
}

export async function getSubject(id: number): Promise<SubjectDTO> {
  const row = await prisma.subject.findUnique({ where: { id } });
  if (!row) throw errors.notFound('科目');
  return toSubjectDTO(row);
}

export async function createSubject(name: string, color: string): Promise<SubjectDTO> {
  const trimmed = name.trim();
  if (!trimmed) throw errors.validation('科目名不能为空');

  const dup = await prisma.subject.findFirst({ where: { name: trimmed, archivedAt: null } });
  if (dup) throw errors.conflict(`科目「${trimmed}」已存在`);

  const max = await prisma.subject.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.subject.create({
    data: { name: trimmed, color, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  return toSubjectDTO(row);
}

export async function updateSubject(
  id: number,
  patch: { name?: string; color?: string; sortOrder?: number; archived?: boolean },
): Promise<SubjectDTO> {
  const existing = await prisma.subject.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('科目');

  if (patch.archived === true) {
    const activeCount = await prisma.subject.count({ where: { archivedAt: null } });
    if (activeCount <= 1) throw errors.conflict('至少需要保留一个启用中的科目');
  }

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw errors.validation('科目名不能为空');
    const dup = await prisma.subject.findFirst({
      where: { name: trimmed, archivedAt: null, id: { not: id } },
    });
    if (dup) throw errors.conflict(`科目「${trimmed}」已存在`);
  }

  const row = await prisma.subject.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
    },
  });
  return toSubjectDTO(row);
}

/** 批量重排（设置页拖拽/上下移） */
export async function reorderSubjects(ids: number[]): Promise<SubjectDTO[]> {
  await prisma.$transaction(
    ids.map((id, index) => prisma.subject.update({ where: { id }, data: { sortOrder: index } })),
  );
  return listSubjects({ includeArchived: true });
}

/** 软删除：保留历史统计。 */
export async function archiveSubject(id: number): Promise<SubjectDTO> {
  return updateSubject(id, { archived: true });
}

/** 该科目下挂了多少条专注记录（归档前提示用） */
export async function countSessionsBySubject(subjectId: number): Promise<number> {
  return prisma.focusSession.count({ where: { subjectId } });
}

export async function seedSubjects(
  presets: ReadonlyArray<{ name: string; color: string }>,
): Promise<SubjectDTO[]> {
  const existing = await prisma.subject.count();
  if (existing > 0) return listSubjects();
  await prisma.$transaction(
    presets.map((p, i) =>
      prisma.subject.create({ data: { name: p.name, color: p.color, sortOrder: i } }),
    ),
  );
  return listSubjects();
}

// ── 今日完成记录 ───────────────────────────────────────────────────────

export async function listItems(date: string): Promise<CompletedItemDTO[]> {
  const rows = await prisma.completedItem.findMany({
    where: { localDate: date },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    localDate: r.localDate,
    subjectId: r.subjectId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createItem(input: {
  title: string;
  subjectId?: number | null;
  note?: string | null;
  date?: string;
}): Promise<CompletedItemDTO> {
  const title = input.title.trim();
  if (!title) throw errors.validation('标题不能为空');
  if (title.length > 200) throw errors.validation('标题过长（上限 200 字）');

  const date = input.date ?? todayLocalDate();
  if (input.subjectId != null) await getSubject(input.subjectId);

  const r = await prisma.completedItem.create({
    data: {
      title,
      localDate: date,
      subjectId: input.subjectId ?? null,
      note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
    },
  });
  return {
    id: r.id,
    title: r.title,
    localDate: r.localDate,
    subjectId: r.subjectId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function deleteItem(id: number): Promise<void> {
  const existing = await prisma.completedItem.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('记录');
  await prisma.completedItem.delete({ where: { id } });
}

// ── 专注记录 ──────────────────────────────────────────────────────────

export interface CreateFocusInput {
  clientId?: string;
  subjectId: number;
  startedAt: string;
  focusMinutes: number;
  plannedMinutes?: number;
  pausedSeconds?: number;
  source: FocusSource;
  note?: string | null;
  /** 仅手动补记使用：显式指定归属日期 */
  localDate?: string;
}

export async function createFocusSession(input: CreateFocusInput) {
  // 幂等：同一个 clientId 重复提交（离线队列重试）直接返回既有记录
  if (input.clientId) {
    const existing = await prisma.focusSession.findUnique({
      where: { clientId: input.clientId },
      include: { subject: true },
    });
    if (existing) return { session: toSessionDTO(existing), deduped: true };
  }

  await getSubject(input.subjectId);

  if (input.focusMinutes <= 0) throw errors.validation('专注时长必须大于 0');
  if (input.focusMinutes > 24 * 60) throw errors.validation('单次专注时长不合理（上限 24 小时）');

  const startedAt = new Date(input.startedAt);
  if (Number.isNaN(startedAt.getTime())) throw errors.validation('开始时间格式不合法');

  const today = todayLocalDate();
  let localDate: string;

  if (input.source === 'manual') {
    localDate = input.localDate ?? localDateOf(startedAt);
    const back = diffDays(localDate, today);
    if (back < 0) throw errors.validation('不能补记未来的日期');
    if (back > MANUAL_BACKFILL_DAYS) {
      throw errors.validation(`最多只能补记过去 ${MANUAL_BACKFILL_DAYS} 天内的记录`);
    }
  } else {
    // 服务端算归属日期，不信任客户端传来的日期（决策 D2）
    localDate = localDateOf(startedAt);
    // 计时以服务端时间为准，但对客户端时钟偏差留 10 分钟容差
    const skew = startedAt.getTime() - Date.now();
    if (skew > 10 * 60_000) throw errors.validation('开始时间晚于服务器当前时间，已拒绝');
    if (skew < -3 * 24 * 3_600_000) throw errors.validation('开始时间过于久远，已拒绝');
  }

  const created = await prisma.focusSession.create({
    data: {
      clientId: input.clientId ?? null,
      subjectId: input.subjectId,
      startedAt,
      localDate,
      focusMinutes: Math.round(input.focusMinutes),
      plannedMinutes: input.plannedMinutes != null ? Math.round(input.plannedMinutes) : null,
      pausedSeconds: Math.max(0, Math.round(input.pausedSeconds ?? 0)),
      source: input.source,
      note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
    },
    include: { subject: true },
  });

  return { session: toSessionDTO(created), deduped: false };
}

export async function listSessionsBetween(from: string, to: string): Promise<FocusSessionDTO[]> {
  const rows = await prisma.focusSession.findMany({
    where: { localDate: { gte: from, lte: to } },
    orderBy: { startedAt: 'asc' },
    include: { subject: true },
  });
  return rows.map(toSessionDTO);
}

/**
 * 整表物化取数。**统计路径已不再使用它**（见 aggregates.ts），保留作两件事：
 *   1. 诊断/对比基准的「旧口径」参照（`.workbuddy/perf-db.mjs` 量现状用）
 *   2. 万一将来需要「把所有原始行拿去别处处理」
 * 新写的聚合逻辑请走 aggregates.ts —— 这条路径的代价是 O(记录数)。
 */
export async function listAllSessionLikes(): Promise<SessionLike[]> {
  const rows = await prisma.focusSession.findMany({
    select: { localDate: true, focusMinutes: true, subjectId: true, startedAt: true, source: true },
    orderBy: { localDate: 'asc' },
  });
  // 这里只取了聚合需要的列，不需要走 toSessionLike（它面向完整行）
  return rows.map((r) => ({
    localDate: r.localDate,
    focusMinutes: r.focusMinutes,
    subjectId: r.subjectId,
    startedAt: r.startedAt.toISOString(),
    source: r.source,
  }));
}

/** 最早记录的归属日期。统计路径改用 totalsAll()（同一次查询顺带拿合计），此处仅作独立工具保留。 */
export async function earliestSessionDate(): Promise<string | null> {
  const row = await prisma.focusSession.findFirst({
    orderBy: { localDate: 'asc' },
    select: { localDate: true },
  });
  return row?.localDate ?? null;
}

export async function deleteFocusSession(id: number): Promise<void> {
  const existing = await prisma.focusSession.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('专注记录');
  await prisma.focusSession.delete({ where: { id } });
}

/** 删除某天的手动补记（今日页「补记」列表用） */
export async function listManualSessions(date: string): Promise<FocusSessionDTO[]> {
  const rows = await prisma.focusSession.findMany({
    where: { localDate: date, source: 'manual' },
    orderBy: { createdAt: 'asc' },
    include: { subject: true },
  });
  return rows.map(toSessionDTO);
}

// ── 统计与快照 ────────────────────────────────────────────────────────

export async function getSnapshot(today = todayLocalDate()) {
  /**
   * 壳层快照。签名与返回值不变（layout / 成就页 / 三个路由都在用），
   * 但内部从「物化整表 + JS 聚合」换成「SQL 聚合 + 小结果集」：
   *   旧 → 2 次查询，其中 1 次拉全表（且 listSubjectLikes 的结果根本没被用到 ——
   *        buildSnapshot 的 subjects 形参是残留）
   *   新 → 4 个聚合，行数分别是 O(天数) / O(1) / O(科目数) / O(天数)
   */
  const [daily, totals, subjectMinutes, earlyBird] = await Promise.all([
    dailyMinutesAll(),
    totalsAll(),
    subjectMinutesAll(),
    hasEarlyBird(),
  ]);

  return buildSnapshotFromDaily(
    daily,
    {
      totalSessions: totals.totalSessions,
      // 有专注记录的科目数。只要有过记录就计入，即使科目后来被归档 —— 与旧口径一致
      // （subjectMinutes 的键 = FocusSession 里出现过的 subjectId 集合）
      subjectCount: subjectMinutes.size,
      hasEarlyBird: earlyBird,
    },
    today,
  );
}

/** 近 N 天的每日总分钟（今日页迷你趋势，可选） */
export async function getRecentDailyMinutes(days = 7, today = todayLocalDate()) {
  const from = addDays(today, -(days - 1));
  const rows = await prisma.focusSession.groupBy({
    by: ['localDate'],
    where: { localDate: { gte: from, lte: today } },
    _sum: { focusMinutes: true },
  });
  const map = new Map(rows.map((r) => [r.localDate, r._sum.focusMinutes ?? 0]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, minutes: map.get(date) ?? 0 };
  });
}

// ── 成就 ──────────────────────────────────────────────────────────────

export async function getUnlockedKeys(): Promise<string[]> {
  const rows = await prisma.achievement.findMany({ select: { key: true } });
  return rows.map((r) => r.key);
}

/**
 * 成就列表。
 *
 * `precomputed` 允许调用方把已经算好的快照传进来 —— 成就页与 /api/achievements
 * 原本是 `listAchievements(today)` 和 `getSnapshot(today)` 各调一遍，
 * 而 listAchievements 内部自己还要再算一次，同一屏把整份快照算了两遍。
 */
export async function listAchievements(
  today = todayLocalDate(),
  precomputed?: Awaited<ReturnType<typeof getSnapshot>>,
): Promise<AchievementDTO[]> {
  const [unlocked, snapshot] = await Promise.all([
    prisma.achievement.findMany(),
    precomputed ? Promise.resolve(precomputed) : getSnapshot(today),
  ]);
  const map = new Map(unlocked.map((u) => [u.key, u.unlockedAt.toISOString()]));

  return BADGES.map((b) => ({
    key: b.key,
    name: b.name,
    desc: b.desc,
    icon: b.icon,
    color: b.color,
    // 已达成但尚未落库（例如历史数据导入后）也按解锁展示，避免徽章墙与统计对不上
    unlockedAt: map.get(b.key) ?? (b.test(snapshot) ? new Date().toISOString() : null),
  }));
}

/**
 * 写入后检测并解锁新成就（决策 D5：解锁判定放服务端）。
 * 返回本次新解锁的 DTO，供前端即时弹窗。
 */
export async function detectAndUnlock(
  today = todayLocalDate(),
): Promise<{ snapshot: Awaited<ReturnType<typeof getSnapshot>>; unlocked: AchievementDTO[] }> {
  const snapshot = await getSnapshot(today);
  const already = await getUnlockedKeys();
  const fresh = newlyUnlocked(snapshot, already);

  if (fresh.length > 0) {
    const now = new Date();
    await prisma.$transaction(
      fresh.map((key) =>
        prisma.achievement.upsert({
          where: { key },
          create: { key, unlockedAt: now },
          update: {},
        }),
      ),
    );
  }

  const unlockedAt = new Date().toISOString();
  const unlocked: AchievementDTO[] = fresh
    .map((key) => BADGES.find((b) => b.key === key))
    .filter((b): b is (typeof BADGES)[number] => Boolean(b))
    .map((b) => ({
      key: b.key,
      name: b.name,
      desc: b.desc,
      icon: b.icon,
      color: b.color,
      unlockedAt,
    }));

  return { snapshot, unlocked };
}
