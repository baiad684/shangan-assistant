/**
 * Prisma 单例 + SQLite 连接调优。
 *
 * 开发环境下 Next 的模块热重载会反复求值模块，挂到 globalThis 上避免连接数爆炸。
 *
 * 为什么要设 PRAGMA：SQLite 的默认配置（delete 日志 / synchronous=FULL / 无 busy_timeout）
 * 面向「单进程、偶尔写」的场景，与本应用不符 —— 每次番茄钟完成都是一次 commit，
 * 写入是热路径。实测（2000 次「插入 + commit」取均值，见 PERF-REVIEW.md 3.2）：
 *   delete + FULL     2.301 ms/次     ← 旧配置
 *   wal    + NORMAL   0.022 ms/次     ← 现在
 *
 * 注意 PRAGMA 的作用域不一样：
 *   - journal_mode 写进库文件头，一次设置永久生效（但重设也无害）
 *   - synchronous / busy_timeout / cache_size 是**连接级**的，连接池里每条新连接都要设一遍。
 *     所以 DATABASE_URL 上加了 connection_limit=1，让连接唯一，这里设一次即覆盖全部。
 *     万一那个参数不被支持而被忽略，最坏情况也只是退回「只有 WAL 生效」——
 *     WAL 是库文件级的，收益的大头已经拿到。
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pragmas?: Promise<void>;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * 逐个下发 PRAGMA。
 *
 * 用 $queryRawUnsafe 而不是 $executeRawUnsafe：`PRAGMA journal_mode = WAL` 会回一行结果，
 * 走 executeRaw 会被 Prisma 判定为「不该有返回结果」而抛错。queryRaw 对「无结果」的语句
 * 也照常工作（返回空数组），所以统一用它，省得逐条区分。
 */
const PRAGMAS = [
  // 库文件级：写事务不再独占整库，读不被写阻塞
  'PRAGMA journal_mode = WAL;',
  // WAL 下不 fsync，靠 checkpoint 保证持久性；崩溃最多丢最后一个事务
  'PRAGMA synchronous = NORMAL;',
  // 并发写排队等待而不是立刻抛 SQLITE_BUSY
  'PRAGMA busy_timeout = 5000;',
  // 页缓存 16MB（默认 2MB）
  'PRAGMA cache_size = -16000;',
  'PRAGMA foreign_keys = ON;',
] as const;

async function applyPragmas(): Promise<void> {
  for (const sql of PRAGMAS) {
    try {
      await prisma.$queryRawUnsafe(sql);
    } catch (err) {
      // 调优失败只影响性能，不该把应用拖垮 —— 记下来继续跑
      console.error(`[db] ${sql} 设置失败（功能不受影响）`, err);
    }
  }
}

/** 幂等的连接初始化。在 bootstrap() 里 await 一次即可。 */
export function dbReady(): Promise<void> {
  if (!globalForPrisma.pragmas) globalForPrisma.pragmas = applyPragmas();
  return globalForPrisma.pragmas;
}
