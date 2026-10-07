/**
 * 重置全部业务数据，把应用恢复到「刚装好、还没引导」的状态。
 *
 * 清空：科目、完成记录、专注记录、成就、全部设置（含密码与考试日期）。
 * 清空后访问首页会自动跳到 /onboarding，需要重新设置密码与科目。
 *
 * 用法：
 *   npx tsx scripts/reset-data.ts          # 只打印当前数据量，不做任何修改
 *   npx tsx scripts/reset-data.ts --yes    # 确认后真正清空
 *
 * 刻意要求显式传 --yes：这个脚本会删掉全部历史，不能靠手滑触发。
 */
import { prisma } from '../src/lib/server/db';

async function counts() {
  const [subjects, items, sessions, achievements, settings] = await Promise.all([
    prisma.subject.count(),
    prisma.completedItem.count(),
    prisma.focusSession.count(),
    prisma.achievement.count(),
    prisma.setting.count(),
  ]);
  return { subjects, items, sessions, achievements, settings };
}

function render(label: string, c: Awaited<ReturnType<typeof counts>>) {
  console.log(`${label}`);
  console.log(`  科目        ${c.subjects}`);
  console.log(`  完成记录    ${c.items}`);
  console.log(`  专注记录    ${c.sessions}`);
  console.log(`  成就        ${c.achievements}`);
  console.log(`  设置项      ${c.settings}`);
}

async function main() {
  const confirmed = process.argv.includes('--yes');

  render('当前数据：', await counts());

  if (!confirmed) {
    console.log('\n这是预演，未做任何修改。');
    console.log('确认要清空全部数据，请执行：npx tsx scripts/reset-data.ts --yes');
    return;
  }

  console.log('\n开始清空…');

  // 顺序无关（没有外键约束），但放在一个事务里保证要么全成要么全不动
  await prisma.$transaction([
    prisma.focusSession.deleteMany(),
    prisma.completedItem.deleteMany(),
    prisma.achievement.deleteMany(),
    prisma.subject.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  // 重置自增序列，让重新引导后的科目从 1 开始编号
  // （sqlite_sequence 只在库里出现过 AUTOINCREMENT 表时才存在，故容错处理）
  try {
    await prisma.$executeRawUnsafe('DELETE FROM sqlite_sequence');
  } catch {
    // 表不存在，无需重置
  }

  console.log('已清空。');
  render('清空后：', await counts());
  console.log('\n下次访问首页会跳到引导页，请重新设置密码、考试日期与科目。');
}

main()
  .catch((err) => {
    console.error('重置失败：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
