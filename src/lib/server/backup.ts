/**
 * 备份与恢复（IMPLEMENTATION.md §4.10）
 *
 * 两个入口：
 *   exportBackup / importBackup —— 设置页的手动导出与恢复（全量覆盖）
 *   writeAutoBackup             —— 每次启动自动落一份到 backups/，按自然天去重、保留 30 份
 *
 * 考研数据无价，这里是最后一道兜底，所以设计上偏向「宁可多写一份」而不是省磁盘。
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';
import { BACKUP_KEEP } from '../types';
import { errors } from './http';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const SCHEMA_VERSION = 1;

export interface BackupPayload {
  version: number;
  exportedAt: string;
  counts: { subjects: number; items: number; sessions: number; achievements: number };
  data: {
    settings: Array<{ key: string; value: string }>;
    subjects: unknown[];
    completedItems: unknown[];
    focusSessions: unknown[];
    achievements: unknown[];
  };
}

export async function exportBackup(): Promise<BackupPayload> {
  const [settings, subjects, completedItems, focusSessions, achievements] = await Promise.all([
    prisma.setting.findMany(),
    prisma.subject.findMany(),
    prisma.completedItem.findMany(),
    prisma.focusSession.findMany(),
    prisma.achievement.findMany(),
  ]);

  return {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      subjects: subjects.length,
      items: completedItems.length,
      sessions: focusSessions.length,
      achievements: achievements.length,
    },
    data: { settings, subjects, completedItems, focusSessions, achievements },
  };
}

/**
 * 全量覆盖导入。整个覆盖过程放在一个事务里：
 * 中途失败不会留下「清空了但没写回」的半残状态。
 */
export async function importBackup(payload: unknown): Promise<BackupPayload['counts']> {
  if (!payload || typeof payload !== 'object') throw errors.validation('备份文件内容不是合法对象');

  const p = payload as Partial<BackupPayload>;
  if (!p.data || typeof p.data !== 'object') throw errors.validation('备份文件缺少 data 字段');
  if (p.version !== undefined && p.version > SCHEMA_VERSION) {
    throw errors.validation(`备份文件版本（v${p.version}）高于当前程序（v${SCHEMA_VERSION}），请先升级程序`);
  }

  const d = p.data as BackupPayload['data'];

  await prisma.$transaction(async (tx) => {
    await tx.focusSession.deleteMany();
    await tx.completedItem.deleteMany();
    await tx.subject.deleteMany();
    await tx.achievement.deleteMany();
    await tx.setting.deleteMany();

    if (d.subjects?.length) await tx.subject.createMany({ data: d.subjects as never[] });
    if (d.completedItems?.length) await tx.completedItem.createMany({ data: d.completedItems as never[] });
    if (d.focusSessions?.length) await tx.focusSession.createMany({ data: d.focusSessions as never[] });
    if (d.achievements?.length) await tx.achievement.createMany({ data: d.achievements as never[] });
    if (d.settings?.length) await tx.setting.createMany({ data: d.settings as never[] });
  });

  return exportBackupCounts();
}

async function exportBackupCounts(): Promise<BackupPayload['counts']> {
  const [subjects, items, sessions, achievements] = await Promise.all([
    prisma.subject.count(),
    prisma.completedItem.count(),
    prisma.focusSession.count(),
    prisma.achievement.count(),
  ]);
  return { subjects, items, sessions, achievements };
}

/** 按自然天去重写入自动备份，返回写入的文件名（今天已备份过则跳过并返回 null） */
export async function writeAutoBackup(today: string): Promise<string | null> {
  const fileName = `${today}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);

  await mkdir(BACKUP_DIR, { recursive: true });

  const existing = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  if (existing.includes(fileName)) return null; // 今天已经备份过，按自然天去重

  const payload = await exportBackup();
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  await pruneBackups();
  return fileName;
}

/** 保留最近 BACKUP_KEEP 份（文件名是 YYYY-MM-DD，字典序即时间序） */
async function pruneBackups(): Promise<string[]> {
  const files = (await readdir(BACKUP_DIR).catch(() => [] as string[]))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  const removed: string[] = [];
  const excess = files.length - BACKUP_KEEP;
  for (let i = 0; i < excess; i++) {
    await unlink(path.join(BACKUP_DIR, files[i]));
    removed.push(files[i]);
  }
  return removed;
}

export async function listBackups(): Promise<Array<{ name: string; size: number; mtime: string }>> {
  await mkdir(BACKUP_DIR, { recursive: true });
  const files = (await readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort().reverse();

  const out: Array<{ name: string; size: number; mtime: string }> = [];
  for (const name of files) {
    try {
      const { size, mtime } = await import('node:fs/promises').then((fs) =>
        fs.stat(path.join(BACKUP_DIR, name)),
      );
      out.push({ name, size, mtime: mtime.toISOString() });
    } catch {
      // 文件刚好被清理掉，忽略
    }
  }
  return out;
}

export async function readBackupFile(name: string): Promise<unknown> {
  // 防目录穿越：只接受严格的 YYYY-MM-DD.json
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) throw errors.validation('备份文件名不合法');
  try {
    return JSON.parse(await readFile(path.join(BACKUP_DIR, name), 'utf8'));
  } catch {
    throw errors.notFound('备份文件');
  }
}
