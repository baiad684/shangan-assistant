# 上岸助手

> 考研学习督促工具 —— 把「今天学了多久」变成看得见的进度：专注计时、XP 等级、连续打卡、成就徽章、学习统计。

单用户自用 Web 应用，手机 / 电脑浏览器均可访问，本地部署、数据自持。

## 功能特性

- **专注计时**：按科目 / 任务记录学习时长。计时状态基于「时间戳 + 分段累计」现算剩余时间，手机锁屏（JS 被冻结）也不会丢账
- **成长体系**：XP 曲线与等级、连续打卡天数、12 枚成就徽章、三层时长目标线
- **统计报表**：学习时长按日 / 科目聚合的可视化图表，支持导出图片
- **多设备一致**：计时以服务端时间为准、写入幂等，手机计时中途电脑打开数据不打架
- **离线可用**：PWA（manifest + service worker），弱网 / 离线仍可打开

## 技术栈

Next.js 15（App Router）· React 19 · TypeScript · Tailwind CSS 4 · Prisma 6 + SQLite · jose（JWT 会话）· bcryptjs · zod

## 架构要点

完整设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)，性能评审见 [PERF-REVIEW.md](./PERF-REVIEW.md)，业务规则见 [IMPLEMENTATION.md](./IMPLEMENTATION.md)。

- **四层单向依赖**：表现层 → API 层（zod 校验、极薄）→ service 层 → Prisma，业务规则既不下沉到 SQL、也不上浮到页面
- **计时不算定时器**：`setInterval` 累加在锁屏场景必然走偏，改为只存「时间戳 + 分段累计」，剩余时间永远现算
- **时区口径唯一**：UTC 存储 + Asia/Shanghai 切日，换算收敛到单一模块，归属日期冗余落库
- **规则纯函数化**：XP 曲线、连续天数、徽章判定全部是不碰数据库的纯函数，可脱离环境单测
- **防过度设计**：单用户工具，明确不做多租户 / CRDT / 状态管理库 / 消息队列

## 快速开始

```bash
# 1. 配置环境变量
cp .env.example .env        # Windows: copy .env.example .env

# 2. 安装依赖（自动执行 prisma generate）
npm install

# 3. 初始化 SQLite 数据库
npm run db:push

# 4. 启动
npm run dev                 # http://localhost:3000
```

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run seed-demo` | 灌入演示数据 |
| `npm run selftest` | 自检 |
| `npm run reset-password` | 重置密码 |
| `npm run reset-data` | 清空业务数据 |
| `npm run db:studio` | Prisma 数据库可视化 |
