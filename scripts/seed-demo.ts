/**
 * 造一批演示数据 —— 没有真实记录时用来预览界面、做视觉回归。
 *
 *   npm run seed-demo -- --yes                    # 默认造最近 45 天
 *   npm run seed-demo -- --days 30 --yes
 *   npm run seed-demo -- --yes --password 1234    # 顺便把登录密码设好
 *
 * 只写不删。想恢复空库：npm run reset-data -- --yes
 * 数据是「可复现」的（固定随机种子），所以同样的参数每次结果一致，适合截图对比。
 */
import { hashPassword } from '../src/lib/server/auth';
import { prisma } from '../src/lib/server/db';
import { markOnboarded, setAuthGuard, setPasswordHash } from '../src/lib/server/settings';
import { addDays, localMidnightUtc, todayLocalDate } from '../src/lib/domain/time';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DAYS = Number(opt('--days') ?? 45);
const PASSWORD = opt('--password');

/** 线性同余伪随机 —— 固定种子，保证可复现 */
function makeRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = makeRandom(20261218);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const SUBJECTS = [
  { name: '数学', color: '#8b5cf6' },
  { name: '英语', color: '#3b82f6' },
  { name: '政治', color: '#e05a5a' },
  { name: '专业课', color: '#f59e0b' },
];

/** 各科目的常见时长档位（分钟），让堆叠图有真实的层次 */
const DURATIONS: Record<string, number[]> = {
  数学: [50, 60, 75, 90],
  英语: [25, 30, 45],
  政治: [25, 40, 50],
  专业课: [60, 75, 90, 105],
};

const NOTES = ['真题一套', '错题复盘', '背单词', '网课第 3 讲', '背诵手册', '模拟卷', null, null, null];

async function main() {
  if (!flag('--yes')) {
    console.log('这会往数据库写入演示记录（只增不删）。');
    console.log('确认请加 --yes：npm run seed-demo -- --yes');
    process.exitCode = 1;
    return;
  }

  const today = todayLocalDate();

  // 1) 科目（按名字去重，已存在就复用）
  const subjectIds = new Map<string, number>();
  for (const [index, s] of SUBJECTS.entries()) {
    const existing = await prisma.subject.findFirst({ where: { name: s.name } });
    const row =
      existing ??
      (await prisma.subject.create({
        data: { name: s.name, color: s.color, sortOrder: index },
      }));
    subjectIds.set(s.name, row.id);
  }
  console.log(`科目就绪：${[...subjectIds.keys()].join(' / ')}`);

  // 2) 可选：设登录密码
  if (PASSWORD) {
    await setPasswordHash(await hashPassword(PASSWORD));
    await markOnboarded();
    await setAuthGuard({ attempts: 0, lockedUntil: null });
    console.log(`登录密码已设为：${PASSWORD}`);
  }

  // 3) 专注记录
  let created = 0;
  for (let back = DAYS - 1; back >= 0; back--) {
    const date = addDays(today, -back);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;

    // 越久远的日子越容易「摆烂」，今天稍作保留（留一两笔给今日页看）
    if (rand() < (isWeekend ? 0.3 : 0.12)) continue;

    const sessionsToday = back === 0 ? between(1, 2) : isWeekend ? between(1, 3) : between(2, 4);
    let hour = 8;

    for (let i = 0; i < sessionsToday; i++) {
      const name = pick(SUBJECTS).name;
      const minutes = pick(DURATIONS[name]);
      hour = Math.min(22, hour + between(1, 3));
      const startedAt = new Date(localMidnightUtc(date).getTime() + hour * 3600_000 + between(0, 50) * 60_000);

      await prisma.focusSession.create({
        data: {
          clientId: `seed-${date}-${i}`,
          subjectId: subjectIds.get(name)!,
          startedAt,
          localDate: date,
          focusMinutes: minutes,
          plannedMinutes: pick([25, 45, 50, 60]),
          pausedSeconds: rand() < 0.25 ? between(30, 300) : 0,
          source: rand() < 0.85 ? 'pomodoro' : 'manual',
          note: pick(NOTES),
        },
      });
      created++;
    }
  }
  console.log(`专注记录：新增 ${created} 条，覆盖最近 ${DAYS} 天`);

  // 4) 今日完成记录（给今日页的清单看着有内容）
  const todayItems = ['背完 List 12', '数学真题 2019 年', '政治马原第一章'];
  for (const [i, title] of todayItems.entries()) {
    const name = SUBJECTS[i % SUBJECTS.length].name;
    const exists = await prisma.completedItem.findFirst({ where: { localDate: today, title } });
    if (exists) continue;
    await prisma.completedItem.create({
      data: { title, localDate: today, subjectId: subjectIds.get(name)! },
    });
  }
  console.log(`今日完成记录：${todayItems.length} 条`);

  console.log('\n完成。打开 http://localhost:3000 即可看到数据。');
  console.log('清空：npm run reset-data -- --yes');
}

main()
  .catch((err) => {
    console.error('造数据失败：', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
