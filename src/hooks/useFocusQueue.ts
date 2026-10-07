'use client';

/**
 * 专注记录的提交队列（离线可续跑、联网自动补交）
 *
 * IMPLEMENTATION.md §7.5 要求：番茄钟断网可继续、联网后自动补交。
 * 实现方式是「本地队列 + 幂等提交」：
 *   - 提交失败且是网络原因 → 留在队列，'online' 事件或下次进入页面时重试
 *   - 服务端按 clientId 幂等（见 server/data.createFocusSession），所以重复补交不会产生脏数据
 *   - 校验类错误（422 等）不重试，直接报给用户并移出队列 —— 重试一万次也还是错的
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiClientError,
  classifySubmissionError,
  type SubmissionFailure,
} from '@/lib/api-client';
import type { AchievementDTO, FocusSessionDTO, FocusSource } from '@/lib/types';

const QUEUE_KEY = 'shangan.focus-queue.v1';
/** 单条记录的最大补交次数，超过则放弃并告知用户（避免队列被永远失败的条目堵死） */
const MAX_ATTEMPTS = 8;

/**
 * 提交结果 = 成功，或三种失败去向。
 * 分级逻辑放在 api-client 里（错误类型的归属地），这里只消费。
 * 区分它们的核心理由是「数据不能丢」：用户认真专注了 45 分钟，
 * 任何一类本可恢复的错误都不该让这条记录消失。
 */
type SendResult = 'ok' | SubmissionFailure;

export interface QueuedFocus {
  clientId: string;
  subjectId: number;
  startedAt: string;
  focusMinutes: number;
  plannedMinutes?: number;
  pausedSeconds?: number;
  source: FocusSource;
  note?: string | null;
  localDate?: string;
  attempts: number;
}

interface SubmitResponse {
  session: FocusSessionDTO;
  deduped: boolean;
  unlocked: AchievementDTO[];
}

function readQueue(): QueuedFocus[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedFocus[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedFocus[]): void {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // 存储不可用：退化为内存队列，本次会话仍能提交
  }
}

export interface UseFocusQueueOptions {
  /** 成功落库（含去重命中）后回调，带上本次新解锁的成就 */
  onRecorded: (session: FocusSessionDTO, unlocks: AchievementDTO[], deduped: boolean) => void;
  /** 无法重试的失败 */
  onFatal: (message: string) => void;
  /** 补交成功（非本次会话直接提交）时提示用 */
  onFlushed?: (count: number) => void;
}

export function useFocusQueue(options: UseFocusQueueOptions) {
  const opts = useRef(options);
  opts.current = options;

  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  useEffect(() => {
    setPending(readQueue().length);
  }, []);

  const send = useCallback(async (item: QueuedFocus): Promise<SendResult> => {
    try {
      const res = await api.post<SubmitResponse>('/api/focus-sessions', {
        clientId: item.clientId,
        subjectId: item.subjectId,
        startedAt: item.startedAt,
        focusMinutes: item.focusMinutes,
        plannedMinutes: item.plannedMinutes,
        pausedSeconds: item.pausedSeconds,
        source: item.source,
        note: item.note,
        localDate: item.localDate,
      });
      opts.current.onRecorded(res.session, res.unlocked ?? [], res.deduped);
      return 'ok';
    } catch (err) {
      const kind = classifySubmissionError(err);
      // 只有确定无法挽回的失败才打扰用户；可重试的情况静默留在队列里
      if (kind === 'fatal') {
        opts.current.onFatal(err instanceof ApiClientError ? err.message : '记录提交失败');
      }
      return kind;
    }
  }, []);

  /**
   * 提交一次专注。
   * 除了「服务端明确拒绝」，一律入队等待补交 —— 包括会话过期和断网。
   */
  const submit = useCallback(
    async (payload: Omit<QueuedFocus, 'attempts'>) => {
      const item: QueuedFocus = { ...payload, attempts: 0 };
      const result = await send(item);

      if (result === 'ok' || result === 'fatal') return;

      const queue = readQueue();
      queue.push(item);
      writeQueue(queue);
      setPending(queue.length);
    },
    [send],
  );

  /** 清空队列（办不成的保留；服务端明确拒绝的丢弃） */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    const queue = readQueue();
    if (queue.length === 0) return;

    flushing.current = true;
    const remain: QueuedFocus[] = [];
    let okCount = 0;
    let dropped = 0;

    try {
      for (let i = 0; i < queue.length; i++) {
        const next: QueuedFocus = { ...queue[i], attempts: queue[i].attempts + 1 };
        const result = await send(next);

        if (result === 'ok') {
          okCount++;
          continue;
        }

        if (result === 'deferred') {
          // 断网 / 会话过期 / 被限流：这一条和后面全部都会以同样的原因失败，
          // 没必要继续试（也会白白消耗重试次数）
          remain.push(next, ...queue.slice(i + 1));
          break;
        }

        if (result === 'retry') {
          // 单条的服务端故障：保留这一条，但不拖住后面的
          if (next.attempts < MAX_ATTEMPTS) {
            remain.push(next);
          } else {
            dropped++;
          }
          continue;
        }

        // fatal：服务端明确拒绝（校验失败等），已在 send 里告知过用户
        dropped++;
      }
    } finally {
      // 放 finally 里，避免中途异常导致 flushing 永远为 true、后续补交全被挡掉
      flushing.current = false;
    }

    writeQueue(remain);
    setPending(remain.length);

    if (okCount > 0) opts.current.onFlushed?.(okCount);
    if (dropped > 0) opts.current.onFatal(`${dropped} 条专注记录服务端拒绝或多次补交失败，已放弃`);
  }, [send]);

  // 联网或回到前台时自动补交
  useEffect(() => {
    void flush();

    const onOnline = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flush]);

  return { submit, flush, pending };
}
