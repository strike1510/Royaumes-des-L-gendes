'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SpriteAnimation, FrameAnimation } from '@/components/BattleArena';
import { TROOP_DATA, campaignChapter, campaignDecorFrames, campaignMonsterFrames, campaignBossFrames } from '@/lib/gameData';
import {
  CombatState, COMBAT_SKILLS, SKILL_BY_ID,
  heroAction, enemyAction, troopsAction, combatOutcome,
} from '@/lib/combatEngine';

const RES_ICON: Record<string, string> = { stone: '🪨', iron: '⛏️', gold: '🪙', food: '🌾', wood: '🪵', magic_energy: '✨' };
const RES_NAME: Record<string, string> = { stone: 'Pierre', iron: 'Fer', gold: 'Or', food: 'Nourriture', wood: 'Bois', magic_energy: 'Énergie magique' };

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

export function TurnBattle({
  initialState, scene, allyTypes, bossImage, enemyFrames, meta, applyResult, onDone, chapter, isBoss, towerFloor,
}: {
  initialState: CombatState;
  scene: 'forest' | 'tower';
  allyTypes: string[];
  bossImage?: string | null;
  enemyFrames?: string[] | null;
  meta: { originalTroops: { type: string; count: number; level: number }[] };
  applyResult: (outcome: { victory: boolean; survivingTroops: Record<string, number> }) => Promise<any>;
  onDone: () => void;
  chapter?: number | null;
  isBoss?: boolean;
  towerFloor?: number | null;
}) {
  const [state, setState] = useState<CombatState>(initialState);
  const [busy, setBusy] = useState(false);
  const [swing, setSwing] = useState(0);
  const [shake, setShake] = useState(false);
  const [rewards, setRewards] = useState<any>(null);   // résumé serveur
  const [applying, setApplying] = useState(false);     // appel serveur en cours
  const [chestOpen, setChestOpen] = useState(false);
  const appliedRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [state.log]);

  const over = state.phase === 'won' || state.phase === 'lost';

  // Dès que le combat est fini, on applique le résultat au serveur une seule fois
  // et on récupère le butin à afficher dans le coffre (sur la même page).
  useEffect(() => {
    if (!over || appliedRef.current) return;
    appliedRef.current = true;
    setApplying(true);
    applyResult(combatOutcome(state, meta.originalTroops))
      .then((res) => setRewards(res))
      .finally(() => setApplying(false));
  }, [over]);

  const bg = scene === 'tower' ? '/backgrounds/tower.png' : '/backgrounds/forest.png';
  const allies = (allyTypes.length ? allyTypes : ['soldier']).map(t => TROOP_DATA[t]?.sprite || 'soldier').slice(0, 3);

  // ----- CAMPAGNE : décor + monstre/boss animés -----
  // La TOUR réutilise aussi les monstres de la campagne : l'étage détermine
  // le chapitre (étages 1-10 → ch.1, 11-20 → ch.2, …, bouclé sur 10 chapitres),
  // et tous les 10 étages on affronte le boss du chapitre.
  const towerChapter = scene === 'tower' && towerFloor
    ? ((Math.ceil(towerFloor / 10) - 1) % 10) + 1
    : null;
  const towerIsBoss = scene === 'tower' && !!towerFloor && towerFloor % 10 === 0;
  const effectiveChapter = scene === 'tower' ? towerChapter : chapter;
  const effectiveIsBoss = scene === 'tower' ? towerIsBoss : isBoss;
  const isCampaign = !!effectiveChapter && !!campaignChapter(effectiveChapter);
  const monPickRef = useRef<number>(1 + Math.floor(Math.random() * 5));
  const campaignDecor = isCampaign && scene === 'forest' ? campaignDecorFrames(effectiveChapter!) : [];
  const campaignEnemyFrames = isCampaign
    ? (effectiveIsBoss ? campaignBossFrames(effectiveChapter!) : campaignMonsterFrames(effectiveChapter!, monPickRef.current))
    : [];


  // Enchaîne automatiquement ennemi -> troupes après l'action du héros.
  const runEnemyThenTroops = (afterHero: CombatState) => {
    if (afterHero.phase === 'won' || afterHero.phase === 'lost') { setState(afterHero); setBusy(false); return; }
    setTimeout(() => {
      const afterEnemy = enemyAction(afterHero);
      setShake(true); setTimeout(() => setShake(false), 250);
      setState(afterEnemy);
      if (afterEnemy.phase === 'won' || afterEnemy.phase === 'lost') { setBusy(false); return; }
      setTimeout(() => {
        const afterTroops = troopsAction(afterEnemy);
        setSwing(s => s + 1);
        setState(afterTroops);
        setBusy(false);
      }, 700);
    }, 650);
  };

  const playSkill = (skillId: string | 'basic') => {
    if (busy || state.phase !== 'hero') return;
    setBusy(true);
    setSwing(s => s + 1);
    const afterHero = heroAction(state, skillId);
    setState(afterHero);
    runEnemyThenTroops(afterHero);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto">
      <div className="w-full max-w-3xl my-4">
        {/* Arène */}
        <div className="relative w-full rounded-2xl overflow-hidden border-2 border-amber-500/40 shadow-2xl" style={{ aspectRatio: '2 / 1' }}>
          <div className="absolute inset-0" style={{ backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center', transform: shake ? 'translateX(5px)' : 'none', transition: 'transform .08s' }}>
            {isCampaign && campaignDecor.length > 0 && (
              <div className="absolute inset-0" style={{ backgroundImage: `url(${campaignDecor[0]})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/20" />

          {/* Barres HP */}
          <div className="absolute top-0 left-0 right-0 p-2 space-y-1">
            <div className="flex gap-3">
              <Bar label="🦸 Héros" hp={state.heroHp} max={state.heroMaxHp} color="bg-gradient-to-r from-amber-500 to-yellow-400" />
              <Bar label={`👹 ${state.enemy.label}`} hp={state.enemy.hp} max={state.enemy.maxHp} color="bg-gradient-to-l from-red-500 to-rose-400" align="right" />
            </div>
            <div className="flex gap-3">
              <Bar label="🛡️ Troupes" hp={state.ally.hp} max={state.ally.maxHp} color="bg-gradient-to-r from-green-500 to-emerald-400" />
              <div className="flex-1" />
            </div>
          </div>

          {/* Allies */}
          <div className="absolute bottom-[8%] left-0 flex items-end gap-1 pl-[4%]" style={{ transform: state.phase === 'troops' ? 'translateX(24px)' : 'none', transition: 'transform .18s' }}>
            {allies.map((s, i) => (
              <div key={i} style={{ marginLeft: i ? -18 : 0, zIndex: 10 - i, opacity: state.ally.hp <= 0 ? 0.25 : 1, filter: state.ally.hp <= 0 ? 'grayscale(1)' : undefined, transition: 'opacity .4s' }}>
                <SpriteAnimation sprite={s} height={128 - i * 12} mode={state.phase === 'troops' ? 'attack' : 'idle'} trigger={swing} />
              </div>
            ))}
          </div>

          {/* Enemy */}
          <div className="absolute bottom-[8%] right-0 flex items-end pr-[4%]" style={{ transform: state.phase === 'enemy' ? 'translateX(-24px)' : 'none', transition: 'transform .18s' }}>
            {isCampaign && campaignEnemyFrames.length > 0
              ? <div style={{ opacity: state.enemy.hp <= 0 ? 0.3 : 1, transition: 'opacity .4s' }}>
                  <FrameAnimation frames={campaignEnemyFrames} flip height={effectiveIsBoss ? 200 : 150} fps={7} attack={state.phase === 'enemy'} trigger={swing} />
                </div>
              : enemyFrames && enemyFrames.length > 0
              ? <div style={{ opacity: state.enemy.hp <= 0 ? 0.3 : 1, transition: 'opacity .4s' }}>
                  <FrameAnimation frames={enemyFrames} flip height={180} fps={6} attack={state.phase === 'enemy'} trigger={swing} />
                </div>
              : bossImage
              ? <img src={bossImage} alt="boss" style={{ height: 200, transform: 'scaleX(-1)', filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.6))', opacity: state.enemy.hp <= 0 ? 0.3 : 1, transition: 'opacity .4s' }} />
              : <div style={{ opacity: state.enemy.hp <= 0 ? 0.3 : 1, transition: 'opacity .4s' }}><SpriteAnimation sprite="ogre" flip height={150} mode={state.phase === 'enemy' ? 'attack' : 'idle'} trigger={swing} /></div>}
          </div>

          {shake && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl animate-ping pointer-events-none">💥</div>}

          {/* Indicateur de tour */}
          {!over && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-amber-300/80 text-sm font-bold pointer-events-none" style={{ textShadow: '0 2px 6px #000' }}>
              Tour {state.turn} · {state.phase === 'hero' ? 'À toi de jouer' : state.phase === 'enemy' ? 'L\'ennemi agit…' : 'Tes troupes frappent…'}
            </div>
          )}

          {/* Résultat */}
          {over && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
              <div className="text-6xl mb-1">{state.phase === 'won' ? '🏆' : '💀'}</div>
              <div className={`text-4xl font-bold ${state.phase === 'won' ? 'text-amber-300' : 'text-red-400'}`} style={{ fontFamily: 'serif', textShadow: '0 2px 10px #000' }}>
                {state.phase === 'won' ? 'VICTOIRE' : 'DÉFAITE'}
              </div>
            </div>
          )}
        </div>

        {/* Journal de combat */}
        <div ref={logRef} className="mt-2 h-24 overflow-y-auto bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-xs space-y-0.5">
          {state.log.map((l, i) => (
            <div key={i} className={
              l.actor === 'hero' ? 'text-amber-200' :
              l.actor === 'enemy' ? 'text-red-300' :
              l.actor === 'troops' ? 'text-green-300' : 'text-amber-400/70 italic'
            }>{l.text}</div>
          ))}
        </div>

        {/* Barre d'actions du héros */}
        {!over && (
          <div className="mt-2 bg-[#1a0a2e] border border-amber-500/40 rounded-xl p-3">
            <div className="text-amber-400 text-xs font-bold mb-2">🌟 Actions du héros {busy && <span className="text-amber-200/50">(résolution…)</span>}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <button
                disabled={busy || state.phase !== 'hero'}
                onClick={() => playSkill('basic')}
                className="rounded-lg p-2 text-left border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 disabled:opacity-40 transition-all">
                <div className="text-amber-200 text-sm font-bold">🗡️ Attaque</div>
                <div className="text-amber-200/50 text-[10px]">Coup de base, sans recharge</div>
              </button>
              {COMBAT_SKILLS.map(spec => {
                const lvl = state.skillLevels[spec.id] || 0;
                if (lvl <= 0) return null;
                const cd = state.skillCooldowns[spec.id] || 0;
                const ready = cd === 0 && state.phase === 'hero' && !busy;
                return (
                  <button
                    key={spec.id}
                    disabled={!ready}
                    onClick={() => playSkill(spec.id)}
                    className={`relative rounded-lg p-2 text-left border transition-all ${ready ? 'border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20' : 'border-amber-500/15 bg-black/20 opacity-50'}`}>
                    <div className="text-amber-200 text-sm font-bold truncate">{spec.icon} {spec.name}</div>
                    <div className="text-amber-200/50 text-[10px]">Niv. {lvl} · {cd > 0 ? `recharge ${cd}` : 'prêt'}</div>
                  </button>
                );
              })}
            </div>
            <div className="text-amber-200/40 text-[10px] mt-2">Améliore et débloque des compétences dans l'onglet Héros. Tes troupes frappent automatiquement en fin de tour.</div>
          </div>
        )}

        {/* Fin de combat : coffre cliquable + récompenses, sur la même page */}
        {over && (
          <div className="mt-2 bg-[#1a0a2e] border border-amber-500/40 rounded-xl p-4">
            {!chestOpen ? (
              <div className="text-center">
                <button
                  onClick={() => setChestOpen(true)}
                  disabled={applying}
                  className="group mx-auto block rounded-xl p-2 hover:bg-amber-500/10 transition-all disabled:opacity-60"
                  aria-label="Ouvrir le coffre">
                  <img
                    src="/loot/chest_closed.png"
                    alt="Coffre"
                    className="mx-auto max-h-40 w-auto object-contain transition-transform group-hover:scale-105"
                    style={{ filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.55))' }} />
                </button>
                <div className={`font-bold mt-1 ${state.phase === 'won' ? 'text-amber-300' : 'text-red-400'}`}>
                  {state.phase === 'won' ? '🎁 Coffre de butin' : '💀 Défaite'}
                </div>
                <div className="text-amber-200/50 text-xs">
                  {applying ? 'Calcul des récompenses…' : 'Clique sur le coffre pour voir tes récompenses.'}
                </div>
              </div>
            ) : (
              <div className="animate-in fade-in zoom-in-95">
                <img
                  src="/loot/chest_open.png"
                  alt="Coffre ouvert"
                  className="mx-auto max-h-36 w-auto object-contain mb-2"
                  style={{ filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.55))' }} />
                {rewards ? (
                  <div className="space-y-2">
                    {rewards.floor && <div className="text-center text-amber-300 text-sm">Étage {rewards.floor} atteint</div>}
                    {rewards.bossName && <div className="text-center text-amber-300/80 text-sm">👹 {rewards.bossName}</div>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div className="bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-amber-200">🏆 Renommée +{rewards.renownGained ?? 0}</div>
                      {(rewards.xpGained ?? 0) > 0 && <div className="bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-amber-200">📊 XP héros +{rewards.xpGained}</div>}
                    </div>
                    {rewards.resourcesGained && Object.entries(rewards.resourcesGained).some(([, v]) => (v as number) > 0) && (
                      <div className="bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2">
                        <div className="text-amber-400/70 text-xs mb-1">Ressources</div>
                        <div className="flex flex-wrap gap-2 text-sm text-amber-200">
                          {Object.entries(rewards.resourcesGained).filter(([, v]) => (v as number) > 0).map(([k, v]) => (
                            <span key={k}>{RES_ICON[k]} +{v as number}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {rewards.specialDrop && (
                      <div className="bg-purple-900/30 border border-purple-400/30 rounded-lg p-2 flex items-center gap-2">
                        {(rewards.specialDrop.icon || rewards.specialDrop.effects?.__icon) && (
                          <img src={rewards.specialDrop.icon || rewards.specialDrop.effects.__icon} alt="" className="h-12 w-12 object-contain rounded bg-black/30 border border-purple-400/30" />
                        )}
                        <div>
                          <div className="text-purple-200 font-bold text-sm">🎁 {rewards.specialDrop.name} ({rewards.specialDrop.rarity})</div>
                          <div className="text-purple-100/60 text-xs">Ajouté à ton inventaire.</div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-amber-200/50 text-sm">{state.phase === 'won' ? 'Aucune récompense.' : 'Pas de butin cette fois.'}</div>
                )}
                <button onClick={onDone}
                  className="mt-3 w-full bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-50 py-2.5 rounded-lg font-bold transition-all">
                  Fermer
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { RES_ICON, RES_NAME };
