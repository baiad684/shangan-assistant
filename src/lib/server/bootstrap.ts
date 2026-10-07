/**
 * 启动钩子。
 *
 * 做三件幂等的事：
 *   1. 下发 SQLite 连接调优（WAL / synchronous / busy_timeout，见 db.ts）
 *   2. 确保预置科目存在（空库时种入）
 *   3. 触发当天自动备份（按自然天去重，见 backup.ts）
 *
 * 通过模块级 Promise 缓存保证同一进程内只跑一次，不阻塞请求路径之外的东西。
 */
import { localDateOf } from '../domain/time';
import { writeAutoBackup } from './backup';
import { dbReady, prisma } from './db';
import { seedSubjects } from './data';

let bootstrapped: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  if (!bootstrapped) {
    bootstrapped = run().catch((err) => {
      // 启动钩子失败不该让整个应用不可用，重置缓存以便下次请求重试
      bootstrapped = null;
      console.error('[bootstrap] 启动初始化失败', err);
    });
  }
  return bootstrapped;
}

async function run(): Promise<void> {
  // 必须先于任何读写：连接级 PRAGMA 要在这个连接上生效，WAL 也要在写第一笔之前切过来
  await dbReady();

  const today = localDateOf(new Date());

  const subjects = await prisma.subject.count();
  if (subjects === 0) {
    const { PRESET_SUBJECTS } = await import('../types');
    await seedSubjects(PRESET_SUBJECTS);
    console.log('[bootstrap] 已种入预置科目');
  }

  const file = await writeAutoBackup(today).catch((err) => {
    console.error('[bootstrap] 自动备份失败', err);
    return null;
  });
  if (file) console.log(`[bootstrap] 已写入自动备份 backups/${file}`);
}
