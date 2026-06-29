'use client';

import React, { useState, useEffect } from 'react';
import { SpriteAnimation } from '@/components/BattleArena';
import { useGameStore, RESOURCE_ICONS } from '@/lib/gameStore';
import { TROOP_DATA, ROLE_INFO, computeTroopCost, townHallLevelForTier } from '@/lib/gameData';

const ALL_TROOPS = ['soldier', 'archer', 'knight', 'mage_guard', 'golem', 'dragon_rider', 'shadow_assassin', 'holy_paladin'];

function notify(message: string, type: 'error' | 'success' = 'error') {
  useGameStore.getState().addNotification({ type, message });
}

// Barre de stat compacte
function Stat({ label, val, max, color }: { label: string; val: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-amber-500/60 w-7 text-[11px]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-black/40 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, (val / max) * 100)}%` }} />
      </div>
      <span className="text-amber-200/70 w-8 text-right text-[11px]">{val}</span>
    </div>
  );
}

export function TroopRecruiter({ emit, availableTroops, ownedCount, resources }: {
  emit: any;
  availableTroops: string[];
  ownedCount: Record<string, number>;
  resources: Record<string, number> | null;
}) {
  const [selected, setSelected] = useState<string>('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  // Sélection par défaut = première unité débloquée.
  useEffect(() => {
    if (availableTroops.length === 0) { setSelected(''); return; }
    if (!selected || !availableTroops.includes(selected)) {
      setSelected(availableTroops[0]);
      setCount(1);
    }
  }, [availableTroops, selected]);

  const cfg = TROOP_DATA[selected];
  const cost = selected ? computeTroopCost(selected, count, ownedCount[selected] || 0) : {};
  const affordable = !resources || Object.entries(cost).every(([r, v]) => (resources[r] ?? 0) >= (v as number));
  const setQty = (n: number) => setCount(Math.max(1, Math.min(999, n || 1)));

  const recruit = () => {
    if (!selected || busy) return;
    if (!affordable) { notify(`Ressources insuffisantes pour ${count} ${cfg.name}.`); return; }
    setBusy(true);
    emit('recruit_troops', { type: selected, count }, (res: any) => {
      setBusy(false);
      if (!res?.success) notify(res?.error || 'Recrutement impossible');
      else { notify(`${count} ${cfg.name} en production !`, 'success'); setCount(1); }
    });
  };

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
      {/* GRILLE : toutes les troupes, cliquables pour produire */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 content-start">
        {ALL_TROOPS.map(t => {
          const c = TROOP_DATA[t];
          if (!c) return null;
          const unlocked = availableTroops.includes(t);
          const active = selected === t;
          const role = ROLE_INFO[c.role];
          return (
            <button
              type="button"
              key={t}
              disabled={!unlocked}
              onClick={() => { if (unlocked) { setSelected(t); setCount(1); } }}
              className={`relative rounded-xl border p-3 text-left transition-all overflow-hidden ${
                !unlocked
                  ? 'border-white/5 bg-[#0d0520]/40 cursor-not-allowed'
                  : active
                    ? 'border-amber-400 ring-2 ring-amber-400/50 bg-amber-500/10 cursor-pointer'
                    : 'border-amber-500/20 hover:border-amber-400/60 hover:bg-amber-500/5 cursor-pointer'
              }`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${c.accent} opacity-15 pointer-events-none`} />
              {/* badge rôle */}
              <div className="relative flex items-start justify-between pointer-events-none mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-black/40 border border-amber-500/20 text-amber-200">{role.icon} {role.name}</span>
                {!unlocked
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-amber-500/60">🔒 HdV {townHallLevelForTier(c.minTier)}</span>
                  : active && <span className="text-amber-300 text-xs font-bold">✓</span>}
              </div>
              <div className="relative flex items-center justify-center h-20 pointer-events-none" style={{ filter: unlocked ? undefined : 'grayscale(1) brightness(0.55)' }}>
                <SpriteAnimation sprite={c.sprite} height={78} mode={active ? 'attack' : 'idle'} trigger={active ? 1 : 0} />
              </div>
              <div className="relative mt-1 pointer-events-none">
                <div className="text-amber-200 font-bold text-sm truncate">{c.icon} {c.name}</div>
                <div className="text-amber-100/60 text-[10px] leading-snug line-clamp-2 min-h-[26px]">{c.roleBonus}</div>
                <div className="flex gap-2 mt-1 text-[10px]">
                  <span className="text-red-300">⚔{c.attack}</span>
                  <span className="text-blue-300">🛡{c.defense}</span>
                  <span className="text-green-300">❤{c.hp}</span>
                  <span className="text-amber-500/50 ml-auto">x{ownedCount[t] || 0}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* PANNEAU DE PRODUCTION */}
      {cfg ? (
        <div className="bg-[#0d0520]/85 border border-amber-500/30 rounded-xl p-4 flex flex-col lg:sticky lg:top-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center h-14 w-14">
              <SpriteAnimation sprite={cfg.sprite} height={52} mode="idle" />
            </div>
            <div>
              <div className="text-amber-300 font-bold text-lg" style={{ fontFamily: 'serif' }}>{cfg.icon} {cfg.name}</div>
              <div className="text-amber-500/50 text-[11px]">HdV Niv. {townHallLevelForTier(cfg.minTier)} · Possédés : {ownedCount[selected] || 0}</div>
            </div>
          </div>

          <div className="mb-2 rounded-lg border border-purple-500/25 bg-purple-500/5 p-2">
            <div className="text-purple-200 text-xs font-bold">{ROLE_INFO[cfg.role].icon} {ROLE_INFO[cfg.role].name}</div>
            <div className="text-amber-200/60 text-[11px] leading-snug mt-0.5">{cfg.roleBonus}</div>
          </div>

          <div className="space-y-1.5 mb-3">
            <Stat label="ATQ" val={cfg.attack} max={50} color="bg-red-500/70" />
            <Stat label="DEF" val={cfg.defense} max={30} color="bg-blue-500/70" />
            <Stat label="PV" val={cfg.hp} max={300} color="bg-green-500/70" />
            <Stat label="VIT" val={cfg.speed} max={12} color="bg-amber-500/70" />
          </div>

          {/* Quantité */}
          <div className="mb-3">
            <div className="text-amber-400/70 text-xs mb-1">Quantité à produire</div>
            <div className="flex items-center gap-1 flex-wrap">
              <button type="button" onClick={() => setQty(count - 10)} className="px-2 h-8 rounded-lg bg-[#1a0a2e] border border-amber-500/30 text-amber-400/80 text-xs hover:bg-amber-500/20">−10</button>
              <button type="button" onClick={() => setQty(count - 5)} className="px-2 h-8 rounded-lg bg-[#1a0a2e] border border-amber-500/30 text-amber-400/80 text-xs hover:bg-amber-500/20">−5</button>
              <button type="button" onClick={() => setQty(count - 1)} className="w-8 h-8 rounded-lg bg-[#1a0a2e] border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 font-bold">−</button>
              <input type="number" value={count} min={1} max={999}
                onChange={(e) => setQty(parseInt(e.target.value))}
                className="w-16 h-8 text-center bg-[#1a0a2e] border border-amber-500/30 rounded-lg text-amber-100 focus:outline-none focus:border-amber-400" />
              <button type="button" onClick={() => setQty(count + 1)} className="w-8 h-8 rounded-lg bg-[#1a0a2e] border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 font-bold">+</button>
              <button type="button" onClick={() => setQty(count + 5)} className="px-2 h-8 rounded-lg bg-[#1a0a2e] border border-amber-500/30 text-amber-400/80 text-xs hover:bg-amber-500/20">+5</button>
              <button type="button" onClick={() => setQty(count + 10)} className="px-2 h-8 rounded-lg bg-[#1a0a2e] border border-amber-500/30 text-amber-400/80 text-xs hover:bg-amber-500/20">+10</button>
            </div>
          </div>

          {/* Coût */}
          <div className="mb-3">
            <div className="text-amber-400/70 text-xs mb-1">Coût total</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(cost).filter(([, v]) => (v as number) > 0).map(([r, v]) => {
                const have = resources?.[r] ?? Infinity;
                const ok = have >= (v as number);
                return (
                  <span key={r} className={`text-xs px-2 py-1 rounded-md border ${ok ? 'border-amber-500/20 text-amber-200' : 'border-red-500/50 text-red-400 bg-red-950/30'}`}>
                    {RESOURCE_ICONS[r]} {(v as number).toLocaleString()}
                  </span>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={recruit}
            className={`mt-auto py-2.5 rounded-lg font-bold transition-all ${
              affordable && !busy
                ? 'bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600 hover:to-red-800 text-amber-50 shadow-lg shadow-red-900/30'
                : 'bg-[#1a0a2e] text-amber-500/40 border border-amber-500/10'
            }`}
          >
            {busy ? '⏳ Production...' : `⚔️ Produire ${count} ${cfg.name}${count > 1 ? 's' : ''}`}
          </button>
        </div>
      ) : (
        <div className="bg-[#0d0520]/80 border border-amber-500/30 rounded-xl p-4 text-amber-500/50 text-sm">
          Aucune unité débloquée à ce niveau. Améliore ton Hôtel de Ville.
        </div>
      )}
    </div>
  );
}
