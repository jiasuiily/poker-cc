import { useState } from 'react';
import { STYLE_IDS, STYLE_NAMES, type StyleId } from '@poker/ai/styles';

export type BotLevelChoice = 'beginner' | 'advanced';
export type BotStyleChoice = StyleId | 'random';

export const LEVEL_NAMES: Record<BotLevelChoice, string> = { beginner: '初级', advanced: '高级' };

const STYLE_HINTS: Record<StyleId, string> = {
  tag: '入池少，入池就主动打',
  lag: '入池多又凶',
  nit: '只玩大牌，很少诈唬',
  station: '什么都跟，很少弃牌',
  maniac: '极松极凶，频繁诈唬',
};

/** "高级·松凶" */
export function botBadge(level?: string, style?: string): string | undefined {
  if (!level) return undefined;
  const l = LEVEL_NAMES[level as BotLevelChoice] ?? level;
  const s = style ? STYLE_NAMES[style as StyleId] ?? style : '';
  return s ? `${l}·${s}` : l;
}

export function LevelStyleFields({
  level,
  style,
  onLevel,
  onStyle,
}: {
  level: BotLevelChoice;
  style: BotStyleChoice;
  onLevel: (l: BotLevelChoice) => void;
  onStyle: (s: BotStyleChoice) => void;
}) {
  const chip = (active: boolean) => `rounded-lg px-3 py-2 text-sm ring-1 ${active ? 'bg-emerald-500/20 ring-emerald-400' : 'ring-white/15'}`;
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-sm text-white/70">电脑难度</div>
        <div className="flex gap-2">
          {(['beginner', 'advanced'] as BotLevelChoice[]).map((l) => (
            <button type="button" key={l} onClick={() => onLevel(l)} className={`flex-1 ${chip(l === level)}`}>
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-sm text-white/70">电脑风格</div>
        <div className="grid grid-cols-3 gap-2">
          {(['random', ...STYLE_IDS] as BotStyleChoice[]).map((s) => (
            <button type="button" key={s} onClick={() => onStyle(s)} className={chip(s === style)} aria-pressed={s === style}>
              {s === 'random' ? '随机' : STYLE_NAMES[s]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-white/50">{style === 'random' ? '每个电脑随机一种风格' : STYLE_HINTS[style]}</p>
      </div>
    </div>
  );
}

/** Modal for "+ 电脑" on an empty seat. Default: 高级 · 随机. */
export function BotPicker({ onPick, onClose }: { onPick: (level: BotLevelChoice, style: BotStyleChoice) => void; onClose: () => void }) {
  const [level, setLevel] = useState<BotLevelChoice>('advanced');
  const [style, setStyle] = useState<BotStyleChoice>('random');
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-felt-dark p-4 shadow-xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="添加电脑玩家">
        <h2 className="mb-3 font-semibold">添加电脑玩家</h2>
        <LevelStyleFields level={level} style={style} onLevel={setLevel} onStyle={setStyle} />
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg py-2.5 ring-1 ring-white/15">
            取消
          </button>
          <button onClick={() => onPick(level, style)} className="flex-1 rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950">
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
