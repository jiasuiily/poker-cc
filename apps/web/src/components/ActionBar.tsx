import { useEffect, useState } from 'react';
import type { PlayerAction, PlayerView } from '@poker/core';

export function ActionBar({ hand, onAct }: { hand: PlayerView; onAct: (a: PlayerAction) => void }) {
  const la = hand.legal!;
  const me = hand.seats.find((s) => s.seat === hand.viewerSeat)!;
  const raise = la.raise;
  const [amount, setAmount] = useState(raise?.min ?? 0);
  const [sent, setSent] = useState(false);

  // New decision point: reset slider and re-enable buttons.
  useEffect(() => {
    setAmount(raise?.min ?? 0);
    setSent(false);
  }, [hand.handId, hand.actionSeq, raise?.min]);

  const send = (a: PlayerAction) => {
    if (sent) return;
    setSent(true);
    onAct(a);
  };

  const isBet = hand.currentBet === 0;
  const potAfterCall = hand.pot + la.toCall;
  const presets: [string, number][] = raise
    ? ([
        ['½池', hand.currentBet + potAfterCall / 2],
        ['⅔池', hand.currentBet + (potAfterCall * 2) / 3],
        ['满池', hand.currentBet + potAfterCall],
        ['全下', raise.max],
      ] as [string, number][]).map(([k, v]) => [k, Math.max(raise.min, Math.min(raise.max, Math.round(v)))])
    : [];
  const allInCall = la.canCall && la.toCall >= me.stack;

  return (
    <div className="space-y-2">
      {raise && raise.max > raise.min && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {presets.map(([label, v]) => (
              <button
                key={label}
                onClick={() => setAmount(v)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs ring-1 ring-white/15 active:bg-white/20"
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={raise.min}
            max={raise.max}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="min-w-0 flex-1 accent-amber-400"
            aria-label="加注金额"
          />
          <input
            type="number"
            inputMode="numeric"
            min={raise.min}
            max={raise.max}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            onBlur={() => setAmount((a) => Math.max(raise.min, Math.min(raise.max, Math.round(a) || raise.min)))}
            className="w-20 rounded-md bg-black/40 px-2 py-1 text-right text-sm ring-1 ring-white/15"
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {la.canFold ? (
          <Btn tone="red" disabled={sent} onClick={() => send({ kind: 'fold' })}>
            弃牌
          </Btn>
        ) : (
          <div />
        )}
        {la.canCheck ? (
          <Btn tone="gray" disabled={sent} onClick={() => send({ kind: 'check' })}>
            过牌
          </Btn>
        ) : (
          <Btn tone="gray" disabled={sent} onClick={() => send({ kind: 'call' })}>
            {allInCall ? `全下 ${la.toCall}` : `跟注 ${la.toCall}`}
          </Btn>
        )}
        {raise ? (
          <Btn
            tone="amber"
            disabled={sent}
            onClick={() => send({ kind: 'raise', to: Math.max(raise.min, Math.min(raise.max, Math.round(amount))) })}
          >
            {amount >= raise.max ? `全下 ${raise.max}` : `${isBet ? '下注' : '加注到'} ${amount}`}
          </Btn>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

function Btn({
  tone,
  children,
  ...rest
}: { tone: 'red' | 'gray' | 'amber' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const c =
    tone === 'red'
      ? 'bg-red-600/90 active:bg-red-700'
      : tone === 'amber'
        ? 'bg-amber-500 text-amber-950 active:bg-amber-600'
        : 'bg-slate-600 active:bg-slate-700';
  return (
    <button {...rest} className={`rounded-xl py-3 text-sm font-semibold shadow disabled:opacity-50 ${c}`}>
      {children}
    </button>
  );
}
