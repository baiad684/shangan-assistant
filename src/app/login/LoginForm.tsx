'use client';

/** 登录表单。单用户单密码，默认记住 30 天。 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui/base';
import { api, ApiClientError, errorMessage } from '@/lib/api-client';

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockedSeconds, setLockedSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  // 打开页面时先看看是否正处于锁定期
  useEffect(() => {
    api
      .get<{ lockedSeconds: number }>('/api/auth/status')
      .then((res) => setLockedSeconds(res.lockedSeconds))
      .catch(() => undefined);
  }, []);

  // 锁定倒计时
  useEffect(() => {
    if (lockedSeconds <= 0) return;
    const id = window.setInterval(() => {
      setLockedSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockedSeconds > 0]);

  const submit = async () => {
    if (busy || lockedSeconds > 0 || !password) return;

    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { password });
      router.replace('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        const details = err.details as { lockedSeconds?: number; attemptsLeft?: number } | undefined;
        if (details?.lockedSeconds) setLockedSeconds(details.lockedSeconds);
        if (typeof details?.attemptsLeft === 'number') setAttemptsLeft(details.attemptsLeft);
      } else {
        setError(errorMessage(err));
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const locked = lockedSeconds > 0;

  return (
    <div className="w-full max-w-[360px]">
      <div className="text-center mb-7">
        <div className="flex items-center justify-center gap-2 text-[22px] font-bold">
          <i className="w-3 h-3 rounded-[3px] bg-brand inline-block" />
          上岸助手
        </div>
        <p className="text-[12.5px] text-ink3 mt-2">记录每一天，离上岸近一点</p>
      </div>

      <div className="bg-card border border-line rounded-2xl p-5">
        <label className="block">
          <span className="block text-[12.5px] font-medium text-ink2 mb-1.5">登录密码</span>
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            disabled={locked}
            placeholder="请输入密码"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </label>

        {error && (
          <p className="mt-3 text-[12.5px] text-danger anim-fade-up">
            {error}
            {attemptsLeft !== null && attemptsLeft > 0 && !locked ? `（还剩 ${attemptsLeft} 次机会）` : ''}
          </p>
        )}

        {locked && (
          <p className="mt-3 text-[12.5px] text-warn">
            已锁定，请等待 {Math.ceil(lockedSeconds / 60)} 分钟（{lockedSeconds} 秒）
          </p>
        )}

        <Button block className="mt-4" disabled={busy || locked || !password} onClick={() => void submit()}>
          {busy ? '登录中…' : locked ? '已锁定' : '登 录'}
        </Button>

        <p className="text-[11.5px] text-ink3 mt-3.5 leading-relaxed">
          默认记住登录 30 天。连续输错 5 次会锁定 10 分钟。
          <br />
          忘记密码？在项目目录运行 <code className="px-1 py-0.5 rounded bg-soft text-[11px]">npm run reset-password</code>
        </p>
      </div>
    </div>
  );
}
