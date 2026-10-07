export const metadata = { title: '离线中 · 上岸助手' };

/**
 * PWA 离线兜底页。
 * 番茄钟的离线续跑由 localStorage + 提交队列保证，不依赖这里；
 * 这一页只是让断网时的页面导航有个像样的落点，而不是浏览器默认的错误页。
 */
export default function OfflinePage() {
  return (
    <main className="min-h-dvh bg-canvas flex items-center justify-center px-6">
      <div className="max-w-[340px] text-center">
        <div className="text-[40px] leading-none">🌊</div>
        <h1 className="text-[18px] font-bold mt-4">现在处于离线状态</h1>
        <p className="text-[13px] text-ink2 mt-2 leading-relaxed">
          页面数据暂时取不到。不过放心：
          <br />
          如果番茄钟正在计时，它不会停 —— 走的是真实时间。
          <br />
          恢复网络后，本地的专注记录会自动补交。
        </p>
        <a
          href="/"
          className="inline-block mt-6 px-5 py-2.5 rounded-xl bg-brand text-white text-[14px] font-semibold"
        >
          重试
        </a>
      </div>
    </main>
  );
}
