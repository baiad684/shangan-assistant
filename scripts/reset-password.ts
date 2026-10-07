/**
 * 重置登录密码。
 *
 *   npm run reset-password              # 交互式输入
 *   npm run reset-password -- 新密码     # 非交互（自动化/忘记密码时最省事）
 *
 * 这是唯一的密码找回途径（IMPLEMENTATION.md §4.11 明确不做线上找回）。
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hashPassword } from '../src/lib/server/auth';
import { getPasswordHash, markOnboarded, setAuthGuard, setPasswordHash } from '../src/lib/server/settings';

async function main() {
  const argPassword = process.argv.slice(2).filter((a) => !a.startsWith('-')).join(' ').trim();

  let password = argPassword;
  if (!password) {
    const rl = createInterface({ input: stdin, output: stdout });
    password = (await rl.question('请输入新密码（至少 4 位）：')).trim();
    const confirm = (await rl.question('请再输入一次确认：')).trim();
    rl.close();

    if (password !== confirm) {
      console.error('两次输入不一致，已取消。');
      process.exitCode = 1;
      return;
    }
  }

  if (password.length < 4) {
    console.error('密码太短（至少 4 位），已取消。');
    process.exitCode = 1;
    return;
  }

  const hadPassword = (await getPasswordHash()) !== null;

  await setPasswordHash(await hashPassword(password));
  await markOnboarded();
  await setAuthGuard({ attempts: 0, lockedUntil: null });

  console.log(`\n✅ 密码已${hadPassword ? '重置' : '设置'}成功。`);
  console.log('   登录失败计数与锁定状态已清零，现在可以正常登录了。');
}

main()
  .catch((err) => {
    console.error('重置失败：', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Prisma 连接需要显式断开，否则脚本不退出
    const { prisma } = await import('../src/lib/server/db');
    await prisma.$disconnect();
  });
