'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SpriteAnimation } from '@/components/BattleArena';
import { TROOP_DATA } from '@/lib/gameData';

// Miroir client des compétences de combat coop (icône + libellé).
const COOP_SKILL_INFO: Record<string, { name: string; icon: string }> = {
  power_strike: { name: 'Frappe puissante', icon: '💥' },
  arcane_blast: { name: 'Déflagration arcanique', icon: '🔮' },
  shield_bash: { name: 'Coup de bouclier', icon: '🛡️' },
  heal_light: { name: 'Lumière guérisseuse', icon: '✨' },
  war_cry: { name: 'Cri de guerre', icon: '📯' },
  iron_wall: { name: 'Mur de fer', icon: '🧱' },
  regeneration: { name: 'Régénération', icon: '💚' },
  berserker: { name: 'Berserker', icon: '🔥' },
};
const COOP_SKILL_ORDER = ['power_strike', 'arcane_blast', 'shield_bash', 'heal_light', 'war_cry', 'iron_wall', 'regeneration', 'berserker'];

function Bar({ label, hp, max, color, align = 'left' }: { label: string; hp: number; max: number; color: string; align?: 'left' | 'right' }) {
  const pct = max > 0 ? Math.max(0, (hp / max) * 100) : 0;
  return (
    <div className={`flex-1 ${align === 'right' ? 'text-right' : ''}`}>
      <div className="flex justify-between text-[11px] font-bold mb-0.5">
        {align === 'left' ? <><span className="text-amber-200">{label}</span><span className="text-amber-200/70">{Math.ceil(hp)}/{max}</span></>
                          : <><span className="text-amber-200/70">{Math.ceil(hp)}/{max}</span><span className="text-amber-200">{label}</span></>}
      </div>
      <div className="h-2.5 rounded-full bg-black/50 overflow-hidden border border-white/10">
        <div className={`h-full ${color} transition-all duration-300 ${align === 'right' ? 'ml-auto' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CoopBattle({
  emit, myPlayerId, scene, bossImage, allyTypes, onDone,
}: {
  emit: (event: string, data: any, cb?: (res: any) => void) => void;
  myPlayerId: string;
  scene: 'forest' | 'tower';
  bossImage?: string | null;
  allyTypes: string[];
  onDone: () => void;
}) {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(30);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Abonnement aux mises à jour d'état coop diffusées par le serveur.
  useEffect(() => {
    const w = window as any;
    const sock = w.__gameSocket;
    if (!sock) return;
    const onState = (s: any) => { setState(s); setBusy(false); };
    const onLog = (e: { text: string }) => {
      setState((prev: any) => prev ? { ...prev, log: [...(prev.log || []), { actor: 'system', text: e.text }].slice(-50) } : prev);
    };
    sock.on('coop_state', onState);
    sock.on('coop_log', onLog);
    // resync immédiat à l'ouverture
    sock.emit('coop_sync', { roomId: w.__coopRoomId }, (res: any) => { if (res?.success && res.state) setState(res.state); });
    return () => { sock.off('coop_state', onState); sock.off('coop_log', onLog); };
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [state?.log]);

  // Compte à rebours du tour actif.
  useEffect(() => {
    if (!state || state.phase !== 'hero') return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [state?.deadline, state?.phase]);

  if (!state) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="text-amber-300 text-lg font-bold animate-pulse">Préparation du combat d'équipe…</div>
      </div>
    );
  }

  const over = state.phase === 'won' || state.phase === 'lost';
  const myTurn = state.phase === 'hero' && state.activePlayerId === myPlayerId;
  const me = state.heroes.find((h: any) => h.playerId === myPlayerId);
  const activeHero = state.heroes.find((h: any) => h.playerId === state.activePlayerId);
  const bg = scene === 'tower' ? '/backgrounds/tower.png' : '/backgrounds/forest.png';
  const allies = (allyTypes.length ? allyTypes : ['soldier']).map(t => TROOP_DATA[t]?.sprite || 'soldier').slice(0, 3);

  const act = (skillId: string) => {
    if (!myTurn || busy) return;
    setBusy(true);
    emit('coop_action', { roomId: (window as any).__coopRoomId, skillId }, (res: any) => {
      if (!res?.success) { setBusy(false); }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto">
      <div className="w-full max-w-3xl my-4">
        {/* Arène */}
        <div className="relative w-full rounded-2xl overflow-hidden border-2 border-amber-500/40 shadow-2xl" style={{ aspectRatio: '2 / 1' }}>
          <div className="absolute inset-0" style={{ backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/20" />

          {/* Barres HP */}
          <div className="absolute top-0 left-0 right-0 p-2 space-y-1">
            <div className="flex gap-3">
              <Bar label="🛡️ Troupes (équipe)" hp={state.ally.hp} max={state.ally.maxHp} color="bg-gradient-to-r from-green-500 to-emerald-400" />
              <Bar label={`👹 ${state.enemy.label}`} hp={state.enemy.hp} max={state.enemy.maxHp} color="bg-gradient-to-l from-red-500 to-rose-400" align="right" />
            </div>
          </div>

          {/* Héros de l'équipe (avatars + PV) */}
          <div className="absolute top-12 left-2 right-2 flex flex-wrap gap-1.5">
            {state.heroes.map((h: any) => {
              const isActive = state.phase === 'hero' && state.activePlayerId === h.playerId;
              const pct = h.maxHp > 0 ? Math.max(0, (h.curHp / h.maxHp) * 100) : 0;
              return (
                <div key={h.playerId}
                  className={`rounded-lg px-2 py-1 border text-[10px] min-w-[88px] ${!h.alive ? 'opacity-40 border-red-500/30 bg-black/40' : isActive ? 'border-amber-400 bg-amber-500/20 ring-1 ring-amber-400' : 'border-amber-500/20 bg-black/40'}`}>
                  <div className="flex items-center gap-1 text-amber-200 font-bold">
                    {isActive && <span>▶</span>}
                    {h.playerId === myPlayerId ? '🦸 Toi' : `🧑 ${h.name}`}
                    {!h.alive && <span>💀</span>}
                  </div>
                  <div className="h-1.5 rounded-full bg-black/50 overflow-hidden mt-0.5">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Allies sprites */}
          <div className="absolute bottom-[8%] left-0 flex items-end gap-1 pl-[4%]">
            {allies.map((s, i) => (
              <div key={i} style={{ marginLeft: i ? -18 : 0, zIndex: 10 - i, opacity: state.ally.hp <= 0 ? 0.25 : 1, filter: state.ally.hp <= 0 ? 'grayscale(1)' : undefined }}>
                <SpriteAnimation sprite={s} height={120 - i * 12} mode={state.phase === 'troops' ? 'attack' : 'idle'} />
              </div>
            ))}
          </div>

          {/* Enemy */}
          <div className="absolute bottom-[8%] right-0 flex items-end pr-[4%]">
            {bossImage
              ? <img src={bossImage} alt="boss" style={{ height: 190, transform: 'scaleX(-1)', filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.6))', opacity: state.enemy.hp <= 0 ? 0.3 : 1 }} />
              : <div style={{ opacity: state.enemy.hp <= 0 ? 0.3 : 1 }}><SpriteAnimation sprite="ogre" flip height={145} mode={state.phase === 'enemy' ? 'attack' : 'idle'} /></div>}
          </div>

          {/* Indicateur de tour */}
          {!over && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none" style={{ textShadow: '0 2px 6px #000' }}>
              <div className="text-amber-300/90 text-sm font-bold">
                Round {state.round} · {
                  state.phase === 'enemy' ? "L'ennemi agit…" :
                  state.phase === 'troops' ? 'Les troupes frappent…' :
                  myTurn ? '⚔️ À TOI de jouer !' : `Au tour de ${activeHero ? activeHero.name : '…'}`
                }
              </div>
              {state.phase === 'hero' && <div className="text-amber-200/70 text-xs mt-0.5">⏳ {remaining}s</div>}
            </div>
          )}

          {/* Résultat */}
          {over && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
              <div className="text-6xl mb-1">{state.phase === 'won' ? '🏆' : '💀'}</div>
              <div className={`text-4xl font-bold ${state.phase === 'won' ? 'text-amber-300' : 'text-red-400'}`} style={{ fontFamily: 'serif', textShadow: '0 2px 10px #000' }}>
                {state.phase === 'won' ? 'VICTOIRE' : 'DÉFAITE'}
              </div>
              <div className="text-amber-200/60 text-xs mt-2">Récompenses appliquées. Tu peux fermer cette fenêtre.</div>
              <button onClick={onDone} className="mt-3 bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-50 px-6 py-2.5 rounded-lg font-bold">Fermer</button>
            </div>
          )}
        </div>

        {/* Journal */}
        <div ref={logRef} className="mt-2 h-24 overflow-y-auto bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-xs space-y-0.5">
          {state.log.map((l: any, i: number) => (
            <div key={i} className={
              l.actor === 'hero' ? 'text-amber-200' :
              l.actor === 'enemy' ? 'text-red-300' :
              l.actor === 'troops' ? 'text-green-300' : 'text-amber-400/70 italic'
            }>{l.text}</div>
          ))}
        </div>

        {/* Actions — seulement quand c'est MON tour */}
        {!over && (
          <div className="mt-2 bg-[#1a0a2e] border border-amber-500/40 rounded-xl p-3">
            <div className="text-amber-400 text-xs font-bold mb-2">
              {myTurn ? '🌟 Tes actions' : `⏳ En attente — ${activeHero ? activeHero.name : '…'} joue`}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <button
                disabled={!myTurn || busy}
                onClick={() => act('basic')}
                className="rounded-lg p-2 text-left border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 disabled:opacity-40 transition-all">
                <div className="text-amber-200 text-sm font-bold">🗡️ Attaque</div>
                <div className="text-amber-200/50 text-[10px]">Coup de base, sans recharge</div>
              </button>
              {me && COOP_SKILL_ORDER.map(id => {
                const lvl = me.skillLevels?.[id] || 0;
                if (lvl <= 0) return null;
                const cd = me.cooldowns?.[id] || 0;
                const info = COOP_SKILL_INFO[id];
                const ready = myTurn && cd === 0 && !busy;
                return (
                  <button key={id} disabled={!ready} onClick={() => act(id)}
                    className={`relative rounded-lg p-2 text-left border transition-all ${ready ? 'border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20' : 'border-amber-500/15 bg-black/20 opacity-50'}`}>
                    <div className="text-amber-200 text-sm font-bold truncate">{info.icon} {info.name}</div>
                    <div className="text-amber-200/50 text-[10px]">Niv. {lvl} · {cd > 0 ? `recharge ${cd}` : 'prêt'}</div>
                  </button>
                );
              })}
            </div>
            {!myTurn && <div className="text-amber-200/40 text-[10px] mt-2">Chaque héros de l'équipe joue à son tour. Patiente, ton tour arrive.</div>}
            {me && !me.alive && <div className="text-red-400/70 text-[10px] mt-2">Ton héros est à terre — tu seras sauté jusqu'à la fin du combat.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
