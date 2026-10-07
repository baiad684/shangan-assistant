'use client';

/**
 * 今日战报：取当日数据 + 弹窗 + PNG 导出（IMPLEMENTATION.md §4.9）
 *
 * 卡片本体在 ReportCard.tsx —— 那部分是纯展示，这里只管数据与交互。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/base';
import { Modal, useToast } from '@/components/ui/overlay';
import { ReportCard, REPORT_CARD_SIZE } from '@/components/report/ReportCard';
import { useToday } from '@/components/today/TodayProvider';
import { api, errorMessage } from '@/lib/api-client';
import { todayLocalDate } from '@/lib/domain/time';
import type { FocusSessionDTO, SliceDatum } from '@/lib/types';

const EXPORT_SCALE = 2; // 375×500 → 750×1000

export function ReportDialog({ dday }: { dday: number }) {
  const { items, aggregate, subjects, goalMinutes } = useToday();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<FocusSessionDTO[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const today = todayLocalDate();

  // 打开时才去取当日明细，避免今日页首屏多一次请求
  useEffect(() => {
    if (!open || sessions !== null) return;
    let cancelled = false;

    api
      .get<{ sessions: FocusSessionDTO[] }>(`/api/focus-sessions?date=${today}`)
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch((err) => {
        if (!cancelled) {
          setSessions([]);
          toast.error(errorMessage(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, sessions, today, toast]);

  /** 今日各科分布（按时长降序） */
  const slices = useMemo<SliceDatum[]>(() => {
    if (!sessions) return [];
    const bySubject = new Map<number, number>();
    for (const s of sessions) {
      bySubject.set(s.subjectId, (bySubject.get(s.subjectId) ?? 0) + s.focusMinutes);
    }
    return [...bySubject.entries()]
      .map(([id, value]) => {
        const subject = subjects.find((x) => x.id === id);
        return {
          label: subject?.name ?? '已删除科目',
          color: subject?.color ?? '#94a3b8',
          value,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [sessions, subjects]);

  const isEmpty = aggregate.minutes <= 0;

  const exportPng = useCallback(async () => {
    const node = cardRef.current;
    if (!node) return;

    setExporting(true);
    try {
      // 强制按 375×500 截取，保证导出图与屏幕尺寸无关
      const dataUrl = await toPng(node, {
        pixelRatio: EXPORT_SCALE,
        cacheBust: true,
        width: REPORT_CARD_SIZE.width,
        height: REPORT_CARD_SIZE.height,
        // 卡片本身有圆角，导出时补一层底色避免透明边
        backgroundColor: '#ffffff',
      });

      const link = document.createElement('a');
      link.download = `上岸助手-战报-${today}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('战报已导出，去相册/下载里看看吧');
    } catch (err) {
      toast.error(`导出失败：${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }, [today, toast]);

  return (
    <>
      <Button block onClick={() => setOpen(true)}>
        生成今日战报
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} className="max-h-[92dvh] overflow-auto">
        <h3 className="text-[16px] font-bold">今日战报</h3>
        <p className="text-[12.5px] text-ink3 mt-1">导出为 750×1000 PNG，适合手机查看与分享。</p>

        <div className="mt-4 flex justify-center">
          <div ref={cardRef}>
            <ReportCard
              date={today}
              totalMinutes={aggregate.minutes}
              slices={slices}
              itemCount={items.length}
              currentStreak={aggregate.currentStreak}
              dday={dday}
              goalMinutes={goalMinutes}
            />
          </div>
        </div>

        <div className="flex gap-2.5 mt-5">
          <Button variant="ghost" block onClick={() => setOpen(false)} disabled={exporting}>
            关闭
          </Button>
          <Button block onClick={() => void exportPng()} disabled={exporting || sessions === null || isEmpty}>
            {exporting ? '生成中…' : '导出 PNG'}
          </Button>
        </div>

        {isEmpty && (
          <p className="text-[12px] text-ink3 text-center mt-3">
            今天还没有专注记录，先去专注一会儿再来导出吧
          </p>
        )}
      </Modal>
    </>
  );
}
