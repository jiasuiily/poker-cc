import { useEffect, useState } from 'react';
import type { DecisionReport } from '@poker/strategy';
import { api, HttpError, type AnalysisResponse, type Session } from '../net/api';
import { playerActionText, STREET_NAMES, verdictMark, verdictText } from '../format';

const LLM_TEXT: Record<string, string> = {
  disabled: '未配置大模型，仅显示本地分析',
  limited: '解说额度已用完，可稍后再试',
  failed: '解说暂不可用',
  idle: '',
  pending: '大模型解说生成中…',
};

/** Loads an existing analysis, or runs one on demand; polls while the LLM commentary is pending. */
export function useAnalysis(session: Session, handId: string) {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getAnalysis(session.token, handId)
      .then((a) => alive && setAnalysis(a))
      .catch((e) => {
        if (alive && !(e instanceof HttpError && e.status === 404)) setErr(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      alive = false;
    };
  }, [session.token, handId]);

  // Poll every 2 s for at most 40 s while commentary is pending.
  useEffect(() => {
    if (analysis?.llmStatus !== 'pending') return;
    let tries = 0;
    const id = setInterval(async () => {
      tries++;
      try {
        const a = await api.getAnalysis(session.token, handId);
        setAnalysis(a);
        if (a.llmStatus !== 'pending') clearInterval(id);
      } catch {
        /* keep polling */
      }
      if (tries >= 20) {
        clearInterval(id);
        setAnalysis((a) => (a && a.llmStatus === 'pending' ? { ...a, llmStatus: 'failed' } : a));
      }
    }, 2000);
    return () => clearInterval(id);
  }, [analysis?.llmStatus, session.token, handId]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setAnalysis(await api.requestAnalysis(session.token, handId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '分析失败');
    } finally {
      setBusy(false);
    }
  };
  return { analysis, busy, err, run };
}

export function AnalysisPanel({ state, onSelect }: { state: ReturnType<typeof useAnalysis>; onSelect: (actionSeq: number) => void }) {
  const { analysis, busy, err, run } = state;
  const canRetry = analysis && (analysis.llmStatus === 'failed' || analysis.llmStatus === 'limited' || analysis.llmStatus === 'idle');
  return (
    <section className="rounded-xl bg-felt-dark p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">近似 GTO 分析</h2>
          <p className="text-xs text-white/50">翻后基于对手范围推断，仅供参考</p>
        </div>
        {(!analysis || canRetry) && (
          <button onClick={run} disabled={busy} className="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">
            {busy ? '分析中…' : analysis?.llmStatus === 'idle' ? '获取 AI 解说' : analysis ? '重新获取解说' : '分析这手牌'}
          </button>
        )}
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {analysis && (
        <>
          {analysis.decisions.length === 0 ? (
            <p className="text-sm text-white/60">这手没有需要你决策的地方</p>
          ) : (
            <ol className="space-y-2">
              {analysis.decisions.map((d) => (
                <DecisionItem key={d.actionSeq} d={d} onClick={() => onSelect(d.actionSeq)} />
              ))}
            </ol>
          )}
          {(analysis.llmStatus === 'ok' && analysis.llmText) || LLM_TEXT[analysis.llmStatus] ? (
            <div className="mt-3 border-t border-white/10 pt-3 text-sm">
              {analysis.llmStatus === 'ok' && analysis.llmText ? (
                <p className="whitespace-pre-wrap leading-relaxed text-white/85">{analysis.llmText}</p>
              ) : (
                <p className="text-white/50">{LLM_TEXT[analysis.llmStatus] ?? ''}</p>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function DecisionItem({ d, onClick }: { d: DecisionReport; onClick: () => void }) {
  const pct = (x?: number) => (x === undefined ? null : `${Math.round(x * 100)}%`);
  return (
    <li>
      <button onClick={onClick} className="w-full rounded-lg bg-black/25 p-2 text-left text-sm hover:bg-black/40">
        <div className="flex flex-wrap items-center gap-x-2">
          <span>{verdictMark(d.verdict)}</span>
          <span className="font-medium">{STREET_NAMES[d.street]}</span>
          <span>你：{playerActionText(d.heroAction)}</span>
          <span className="text-white/60">建议：{playerActionText(d.recommended)}</span>
          <span className="ml-auto text-xs text-white/60">
            {verdictText(d.verdict)}
            {d.evLossBb > 0 ? ` · 约少赚 ${d.evLossBb.toFixed(1)}bb` : ''}
          </span>
        </div>
        {(d.equity !== undefined || d.potOdds !== undefined) && (
          <div className="mt-1 text-xs text-white/60">
            {pct(d.equity) && `胜率 ${pct(d.equity)}`}
            {pct(d.potOdds) && ` · 底池赔率 ${pct(d.potOdds)}`}
            {pct(d.mdf) && ` · 最小防守频率 ${pct(d.mdf)}`}
          </div>
        )}
        <ul className="mt-1 list-disc pl-5 text-xs text-white/70">
          {d.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </button>
    </li>
  );
}
