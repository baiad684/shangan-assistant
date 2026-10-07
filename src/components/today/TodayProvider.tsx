'use client';

/**
 * 今日数据客户端状态（ARCHITECTURE.md §6 的「乐观更新 + 服务端为准」）
 *
 * 设计：服务端组件把首屏数据作为 initial 注入，之后所有变更都由 API 响应里的
 * today 聚合结果直接覆盖本地状态 —— 因此不需要 router.refresh() 二次往返，
 * 进度条/连续天数/经验条会立刻跟上，且口径仍以服务端返回值为准。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CompletedItemDTO, LevelInfo, SubjectDTO } from '@/lib/types';

export interface TodayAggregate {
  date: string;
  minutes: number;
  checkedIn: boolean;
  passed: boolean;
  currentStreak: number;
  totalMinutes: number;
  level: LevelInfo;
}

interface TodayContextValue {
  aggregate: TodayAggregate;
  items: CompletedItemDTO[];
  subjects: SubjectDTO[];
  goalMinutes: number;
  examDate: string;
  dday: number;
  addItem: (item: CompletedItemDTO) => void;
  removeItem: (id: number) => void;
  /** 用服务端返回的聚合结果覆盖本地（专注提交/删除后调用） */
  applyAggregate: (next: TodayAggregate) => void;
  setSubjects: (next: SubjectDTO[]) => void;
  /** 连续打卡天数在删除记录时可能回退，单独覆盖 */
  patchAggregate: (patch: Partial<TodayAggregate>) => void;
}

const TodayContext = createContext<TodayContextValue | null>(null);

export function useToday(): TodayContextValue {
  const ctx = useContext(TodayContext);
  if (!ctx) throw new Error('useToday 必须在 TodayProvider 内使用');
  return ctx;
}

export function TodayProvider({
  initial,
  items: initialItems,
  subjects: initialSubjects,
  goalMinutes,
  examDate,
  dday,
  children,
}: {
  initial: TodayAggregate;
  items: CompletedItemDTO[];
  subjects: SubjectDTO[];
  goalMinutes: number;
  examDate: string;
  dday: number;
  children: ReactNode;
}) {
  const [aggregate, setAggregate] = useState<TodayAggregate>(initial);
  const [items, setItems] = useState<CompletedItemDTO[]>(initialItems);
  const [subjects, setSubjects] = useState<SubjectDTO[]>(initialSubjects);

  const addItem = useCallback((item: CompletedItemDTO) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const removeItem = useCallback((id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const applyAggregate = useCallback((next: TodayAggregate) => {
    setAggregate(next);
  }, []);

  const patchAggregate = useCallback((patch: Partial<TodayAggregate>) => {
    setAggregate((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<TodayContextValue>(
    () => ({
      aggregate,
      items,
      subjects,
      goalMinutes,
      examDate,
      dday,
      addItem,
      removeItem,
      applyAggregate,
      patchAggregate,
      setSubjects,
    }),
    [
      aggregate,
      items,
      subjects,
      goalMinutes,
      examDate,
      dday,
      addItem,
      removeItem,
      applyAggregate,
      patchAggregate,
      setSubjects,
    ],
  );

  return <TodayContext.Provider value={value}>{children}</TodayContext.Provider>;
}
