/**
 * 鉴权链路自检。
 *
 * 存在的理由：smoke test 里出现过「正确密码被拒绝」的真实故障 ——
 * setPasswordHash 用 writeJson 落库（值带引号），而读取端用 readRaw，
 * 拿到的 hash 首尾多两个引号，bcrypt.compare 永远失败。
 * 这类「写入/读取序列化不对称」的 bug 静态检查抓不到，只能用往返测试守住。
 *
 * 用法：npx tsx scripts/verify-auth.ts
 * 注意：会临时改写数据库里的 passwordHash，结束后恢复原值。
 */
import { hash } from 'bcryptjs';
import { getAuthGuard, getPasswordHash, setAuthGuard, setPasswordHash } from '../src/lib/server/settings';
import {
  assertLoginAllowed,
  clearLoginFailures,
  failedAttempts,
  hasPassword,
  lockedSecondsLeft,
  registerLoginFailure,
  verifyPassword,
} from '../src/lib/server/auth';
import { prisma } from '../src/lib/server/db';
import { LOGIN_MAX_ATTEMPTS } from '../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('鉴权链路自检\n');

  const original = await getPasswordHash();
  const originalGuard = await getAuthGuard();
  console.log(`当前库中 hash：${original ? `${original.slice(0, 12)}…（${original.length} 字符）` : '（无）'}`);
  console.log('');

  try {
    // ── 1. 往返一致性：写进去什么，读出来必须一模一样 ──────────────
    console.log('[1] hash 读写往返');
    const sample = await hash('round-trip-probe', 10);
    await setPasswordHash(sample);
    const readBack = await getPasswordHash();

    check('读回的值非空', readBack !== null);
    check(
      '读回的值与写入值完全相等',
      readBack === sample,
      readBack === null
        ? '读回 null'
        : `长度 ${readBack.length} vs ${sample.length}；首字符 "${readBack[0]}"`,
    );
    check('读回值不含引号（序列化对称）', readBack !== null && !readBack.startsWith('"') && !readBack.endsWith('"'));
    check('读回值是合法的 bcrypt 格式', readBack !== null && /^\$2[aby]\$\d{2}\$/.test(readBack));

    // ── 2. 校验函数对正确/错误密码的判定 ──────────────────────────
    // 注意 verifyPassword 的签名是 (plain, hash) —— 必须显式传库里的 hash。
    console.log('\n[2] verifyPassword 判定');
    const known = await hash('correct-horse', 10);
    await setPasswordHash(known);
    check('正确密码 → 通过', (await verifyPassword('correct-horse', known)) === true);
    check('错误密码 → 拒绝', (await verifyPassword('wrong-horse', known)) === false);
    check('空密码 → 拒绝', (await verifyPassword('', known)) === false);
    check('大小写不同 → 拒绝', (await verifyPassword('Correct-Horse', known)) === false);

    // ── 3. 异常输入不应抛错，只能判假 ─────────────────────────────
    // 脏数据（截断的 hash、引号污染的 hash）不能让登录接口 500。
    console.log('\n[3] 脏 hash 的容错');
    check('截断的 hash → 拒绝且不抛错', (await verifyPassword('correct-horse', '$2b$10$lLXZr')) === false);
    check('带引号的 hash → 拒绝且不抛错', (await verifyPassword('correct-horse', `"${known}"`)) === false);
    check('空字符串 hash → 拒绝且不抛错', (await verifyPassword('correct-horse', '')) === false);

    // ── 4. 连续失败锁定（决策 D10）───────────────────────────────
    console.log('\n[4] 连续失败锁定');
    await clearLoginFailures();
    check('初始未锁定', (await lockedSecondsLeft()) === 0);

    let lastResult: { attemptsLeft: number; locked: boolean } | null = null;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      lastResult = await registerLoginFailure();
    }
    check(
      `第 ${LOGIN_MAX_ATTEMPTS} 次失败触发锁定`,
      lastResult?.locked === true && lastResult?.attemptsLeft === 0,
      `实际 ${JSON.stringify(lastResult)}`,
    );
    check('锁定后 lockedSecondsLeft > 0', (await lockedSecondsLeft()) > 0);

    let blocked = false;
    try {
      await assertLoginAllowed();
    } catch {
      blocked = true;
    }
    check('锁定期内登录被拦截', blocked);

    // 锁定状态必须落在库里（不是内存），进程重启后依然生效
    const persisted = await getAuthGuard();
    check('锁定状态已持久化到库', (persisted.lockedUntil ?? 0) > Date.now());

    await clearLoginFailures();
    check('清除后恢复可登录', (await lockedSecondsLeft()) === 0);
    check('清除后失败计数归零', (await failedAttempts()) === 0);

    // ── 5. 未设置密码时的边界 ────────────────────────────────────
    console.log('\n[5] 无密码边界');
    await prisma.setting.deleteMany({ where: { key: 'passwordHash' } });
    check('无密码时 getPasswordHash 返回 null', (await getPasswordHash()) === null);
    check('无密码时 hasPassword 返回 false', (await hasPassword()) === false);
  } finally {
    // 恢复原值，避免污染开发数据
    if (original) {
      await setPasswordHash(original);
      const restored = await getPasswordHash();
      console.log(`\n已恢复原 hash：${restored === original ? '成功' : '失败（不一致！）'}`);
    } else {
      await prisma.setting.deleteMany({ where: { key: 'passwordHash' } });
      console.log('\n原本无密码，已清空还原');
    }
    await setAuthGuard(originalGuard);
    console.log('已恢复原登录守卫状态');
    await prisma.$disconnect();
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('自检异常中断：', err);
  process.exitCode = 1;
});
