'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SPRITE_FRAMES, ENEMY_SPRITES, TROOP_DATA, campaignDecorFrames, campaignMonsterFrames, campaignBossFrames, campaignChapter } from '@/lib/gameData';

// Pioche n sprites ennemis au hasard dans le pool.
function pickRandomEnemies(n: number): string[] {
  const pool = [...ENEMY_SPRITES];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}

// ============================================================
// SpriteAnimation — cycles a sprite's frames.
// mode 'idle' loops gently; 'attack' plays the swing once on `trigger`.
// ============================================================
export function SpriteAnimation({
  sprite, flip = false, height = 120, mode = 'idle', trigger = 0, fps = 8,
}: {
  sprite: string; flip?: boolean; height?: number;
  mode?: 'idle' | 'attack'; trigger?: number; fps?: number;
}) {
  const frames = SPRITE_FRAMES[sprite] || 1;
  const [frame, setFrame] = useState(0);
  const raf = useRef<number | null>(null);

  // idle: slow ping-pong over first 2 frames; attack: one full sweep
  useEffect(() => {
    let mounted = true;
    let i = 0;
    const seq = mode === 'attack'
      ? [0, 1, 2, 3, 4, 0]
      : [0, 1, 0];
    const step = () => {
      if (!mounted) return;
      setFrame(seq[i % seq.length]);
      i++;
      if (mode === 'attack' && i >= seq.length) { setFrame(0); return; }
    };
    const id = setInterval(step, 1000 / fps);
    return () => { mounted = false; clearInterval(id); if (raf.current) cancelAnimationFrame(raf.current); };
  }, [mode, trigger, fps, frames]);

  return (
    <div
      style={{
        height, width: height * 0.8,
        backgroundImage: `url(/sprites/${sprite}_${frame + 1}.png)`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center bottom',
        transform: flip ? 'scaleX(-1)' : undefined,
        filter: 'drop-shadow(0 6px 6px rgba(0,0,0,.5))',
        transition: 'transform .15s',
      }}
    />
  );
}

type Phase = 'intro' | 'fight' | 'result';

// ============================================================
// FrameAnimation — anime une séquence d'images (chemins complets).
// Sert aux monstres/boss/décors animés de la campagne.
// ============================================================
export function FrameAnimation({
  frames, flip = false, height = 130, fps = 7, attack = false, trigger = 0,
}: {
  frames: string[]; flip?: boolean; height?: number; fps?: number; attack?: boolean; trigger?: number;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!frames.length) return;
    let i = 0;
    const seq = attack ? [0, 1, 2, 3, 4, 0] : [0, 1, 2, 1];
    const id = setInterval(() => {
      setIdx(seq[i % seq.length] % frames.length);
      i++;
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [frames, attack, fps, trigger]);

  return (
    <div
      style={{
        height, width: height * 0.85,
        backgroundImage: `url(${frames[idx] || frames[0]})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center bottom',
        transform: flip ? 'scaleX(-1)' : undefined,
        filter: 'drop-shadow(0 6px 6px rgba(0,0,0,.5))',
      }}
    />
  );
}

// Décor animé (croise en fondu entre 2 images).
export function AnimatedDecor({ frames }: { frames: string[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setOn(o => !o), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      {frames.map((src, i) => (
        <div key={i} className="absolute inset-0"
          style={{
            backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center',
            opacity: (i === 0) === !on ? 1 : 0,
            transition: 'opacity .9s ease-in-out',
          }} />
      ))}
    </>
  );
}


// ============================================================
// BattleArena — animated cinematic for a battle.
// scene: 'forest' (campaign) | 'tower'. result holds victory + gains.
// ============================================================
export function BattleArena({
  scene, allyTypes, result, onClose, bossImage, chapter, isBoss,
}: {
  scene: 'forest' | 'tower';
  allyTypes: string[];
  result: any;
  onClose: () => void;
  bossImage?: string | null;
  chapter?: number | null;
  isBoss?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(result?.turnBattle ? 'result' : 'intro');
  const [swing, setSwing] = useState(0);
  const [allyLunge, setAllyLunge] = useState(false);
  const [enemyLunge, setEnemyLunge] = useState(false);
  const [shake, setShake] = useState(false);
  const [chestOpened, setChestOpened] = useState(false);

  // Compteurs en direct du combat.
  const sentTotal = result?.troopsSent
    ? Object.values(result.troopsSent).reduce((a: number, b: any) => a + (b || 0), 0)
    : (allyTypes.length || 1);
  const lostTotal = result?.troopsLost
    ? Object.values(result.troopsLost).reduce((a: number, b: any) => a + (b || 0), 0)
    : 0;
  const enemyTotal = result?.enemyTotal ?? 6;
  const enemyKilledFinal = result?.enemyKilled ?? (result?.victory ? enemyTotal : 0);

  const [alliesAlive, setAlliesAlive] = useState(sentTotal);
  const [enemiesDead, setEnemiesDead] = useState(0);
  const [floaters, setFloaters] = useState<{ id: number; side: 'ally' | 'enemy'; text: string }[]>([]);
  const floatId = useRef(0);

  const addFloater = (side: 'ally' | 'enemy', text: string) => {
    const id = ++floatId.current;
    setFloaters(f => [...f, { id, side, text }]);
    setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 900);
  };

  // pick up to 3 ally sprites + random enemy sprites
  const allies = (allyTypes.length ? allyTypes : ['soldier'])
    .map(t => TROOP_DATA[t]?.sprite || 'soldier').slice(0, 3);
  // Ennemis tirés aléatoirement (mémorisés une fois par combat).
  const enemiesRef = useRef<string[]>(pickRandomEnemies(result?.victory ? 2 : 3));
  const enemies = enemiesRef.current;

  // ----- CAMPAGNE : décor + monstre/boss animés -----
  const isCampaign = scene === 'forest' && !!chapter && !!campaignChapter(chapter);
  const chData = isCampaign ? campaignChapter(chapter!) : null;
  // Monstre normal tiré au hasard (1..5), figé pour la durée du combat.
  const monPickRef = useRef<number>(1 + Math.floor(Math.random() * 5));
  const campaignDecor = isCampaign ? campaignDecorFrames(chapter!) : [];
  const campaignEnemyFrames = isCampaign
    ? (isBoss ? campaignBossFrames(chapter!) : campaignMonsterFrames(chapter!, monPickRef.current))
    : [];
  const campaignEnemyName = chData ? (isBoss ? chData.boss : chData.monsters[monPickRef.current - 1]) : '';

  const bg = scene === 'tower' ? '/backgrounds/tower.png' : '/backgrounds/forest.png';

  useEffect(() => {
    // Combat tour par tour déjà joué ailleurs : on saute l'animation et on
    // affiche directement l'écran de fin avec le coffre cliquable.
    if (result?.turnBattle) {
      setChestOpened(false);
      setAlliesAlive(sentTotal - lostTotal);
      setEnemiesDead(enemyKilledFinal);
      setPhase('result');
      return;
    }
    const ROUNDS = 4;
    const timers: any[] = [];
    setChestOpened(false);
    setAlliesAlive(sentTotal);
    setEnemiesDead(0);
    timers.push(setTimeout(() => setPhase('fight'), 900));
    // exchange of blows — chaque round applique une part des pertes/morts en direct
    for (let k = 0; k < ROUNDS; k++) {
      const frac = (k + 1) / ROUNDS;
      timers.push(setTimeout(() => {
        setAllyLunge(true); setSwing(s => s + 1);
        // ennemis tués cumulés jusqu'à ce round
        const deadNow = Math.round(enemyKilledFinal * frac);
        setEnemiesDead(prev => {
          if (deadNow > prev) addFloater('enemy', `-${deadNow - prev}`);
          return deadNow;
        });
        timers.push(setTimeout(() => { setAllyLunge(false); setShake(true); }, 220));
        timers.push(setTimeout(() => setShake(false), 420));
      }, 1100 + k * 700));
      timers.push(setTimeout(() => {
        setEnemyLunge(true);
        // pertes alliées cumulées
        const aliveNow = Math.round(sentTotal - lostTotal * frac);
        setAlliesAlive(prev => {
          if (aliveNow < prev) addFloater('ally', `-${prev - aliveNow}`);
          return aliveNow;
        });
        timers.push(setTimeout(() => setEnemyLunge(false), 220));
      }, 1400 + k * 700));
    }
    timers.push(setTimeout(() => {
      setAlliesAlive(sentTotal - lostTotal);
      setEnemiesDead(enemyKilledFinal);
      setPhase('result');
    }, 1100 + ROUNDS * 700 + 200));
    return () => timers.forEach(clearTimeout);
  }, []);

  const enemyAliveCount = Math.max(0, enemyTotal - enemiesDead);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl">
        {/* Arena */}
        <div
          className="relative w-full rounded-2xl overflow-hidden border-2 border-amber-500/40 shadow-2xl"
          style={{ aspectRatio: '2 / 1' }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${bg})`, backgroundSize: 'cover',
              backgroundPosition: 'center',
              transform: shake ? 'translateX(6px)' : 'none',
              transition: 'transform .08s',
            }}
          >
            {isCampaign && campaignDecor.length > 0 && (
              <div className="absolute inset-0" style={{ backgroundImage: `url(${campaignDecor[0]})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />

          {/* HUD live : barres et compteurs des deux camps */}
          {phase !== 'intro' && (
            <div className="absolute top-0 left-0 right-0 p-2 flex justify-between gap-3 text-xs font-bold pointer-events-none">
              <div className="flex-1 max-w-[45%]">
                <div className="text-green-300 mb-0.5 flex justify-between">
                  <span>🛡️ Tes troupes</span><span>{alliesAlive}/{sentTotal}</span>
                </div>
                <div className="h-2 rounded-full bg-black/50 overflow-hidden border border-green-500/30">
                  <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-300"
                    style={{ width: `${sentTotal ? (alliesAlive / sentTotal) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="flex-1 max-w-[45%] text-right">
                <div className="text-red-300 mb-0.5 flex justify-between">
                  <span>{enemyAliveCount}/{enemyTotal}</span><span>Ennemis 👹</span>
                </div>
                <div className="h-2 rounded-full bg-black/50 overflow-hidden border border-red-500/30">
                  <div className="h-full bg-gradient-to-l from-red-500 to-rose-400 transition-all duration-300 ml-auto"
                    style={{ width: `${enemyTotal ? (enemyAliveCount / enemyTotal) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Nombres flottants de dégâts */}
          {floaters.map(f => (
            <div key={f.id}
              className={`absolute text-2xl font-extrabold pointer-events-none battle-floater ${
                f.side === 'ally' ? 'left-[18%] text-red-400' : 'right-[18%] text-amber-300'
              }`}
              style={{ top: '42%', textShadow: '0 2px 6px #000' }}>
              {f.text}
            </div>
          ))}

          {/* Allies — left, facing right */}
          <div
            className="absolute bottom-[8%] left-0 flex items-end gap-1 pl-[4%]"
            style={{
              transform: allyLunge ? 'translateX(28px)' : 'translateX(0)',
              transition: 'transform .18s ease-out',
            }}
          >
            {allies.map((s, i) => {
              const dead = (sentTotal - alliesAlive) >= Math.ceil(((i + 1) / allies.length) * sentTotal) && alliesAlive < sentTotal;
              return (
              <div key={i} style={{
                marginLeft: i ? -18 : 0, zIndex: 10 - i,
                transform: dead ? 'rotate(-80deg) translateY(20px)' : undefined,
                opacity: dead ? 0.25 : 1,
                filter: dead ? 'grayscale(1)' : undefined,
                transition: 'transform .4s, opacity .4s, filter .4s',
              }}>
                <SpriteAnimation
                  sprite={s} height={130 - i * 12}
                  mode={phase === 'fight' && !dead ? 'attack' : 'idle'} trigger={swing}
                />
              </div>
              );
            })}
          </div>

          {/* Enemies — right, facing left (flipped) */}
          <div
            className="absolute bottom-[8%] right-0 flex items-end gap-1 pr-[4%]"
            style={{
              transform: enemyLunge ? 'translateX(-28px)' : 'translateX(0)',
              transition: 'transform .18s ease-out',
            }}
          >
            {isCampaign && campaignEnemyFrames.length > 0 ? (
              isBoss ? (
                <FrameAnimation
                  frames={campaignEnemyFrames} flip height={210} fps={7}
                  attack={phase === 'fight'} trigger={swing}
                />
              ) : (
                // 3 copies du monstre tiré, tombent au fil des morts.
                Array.from({ length: Math.min(3, enemyTotal) }).map((_, i, arr) => {
                  const dead = enemiesDead >= Math.ceil(((i + 1) / arr.length) * enemyTotal);
                  return (
                    <div key={i} style={{
                      marginRight: i ? -18 : 0, zIndex: 10 - i,
                      transform: dead ? 'rotate(80deg) translateY(20px)' : undefined,
                      opacity: dead ? 0.25 : 1,
                      filter: dead ? 'grayscale(1)' : undefined,
                      transition: 'transform .4s, opacity .4s, filter .4s',
                    }}>
                      <FrameAnimation
                        frames={campaignEnemyFrames} flip height={130 - i * 12} fps={7}
                        attack={phase === 'fight' && !dead} trigger={swing}
                      />
                    </div>
                  );
                })
              )
            ) : bossImage ? (
              <img
                src={bossImage}
                alt="boss"
                style={{
                  height: 210, width: 'auto', transform: 'scaleX(-1)',
                  filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.6))',
                  imageRendering: 'auto',
                }}
              />
            ) : enemies.map((s, i) => {
              // un ennemi "tombe" dès que la part de morts atteint son rang
              const dead = enemiesDead >= Math.ceil(((i + 1) / enemies.length) * enemyTotal);
              return (
              <div key={i} style={{
                marginRight: i ? -18 : 0, zIndex: 10 - i,
                transform: dead ? 'rotate(80deg) translateY(20px)' : undefined,
                opacity: dead ? 0.25 : 1,
                filter: dead ? 'grayscale(1)' : undefined,
                transition: 'transform .4s, opacity .4s, filter .4s',
              }}>
                <SpriteAnimation
                  sprite={s} flip height={130 - i * 12}
                  mode={phase === 'fight' && !dead ? 'attack' : 'idle'} trigger={swing}
                />
              </div>
              );
            })}
          </div>

          {/* clash spark */}
          {shake && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl animate-ping pointer-events-none">💥</div>
          )}

          {/* intro banner */}
          {phase === 'intro' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {result.bossName && (
                <div className="text-red-300 text-lg font-bold mb-1" style={{ textShadow: '0 2px 6px #000' }}>👹 {result.bossName}</div>
              )}
              {isCampaign && campaignEnemyName && (
                <div className={`text-lg font-bold mb-1 ${isBoss ? 'text-red-300' : 'text-amber-200'}`} style={{ textShadow: '0 2px 6px #000' }}>
                  {isBoss ? '👑' : '👹'} {campaignEnemyName}
                </div>
              )}
              <div className="text-amber-300 text-3xl font-bold tracking-widest animate-pulse" style={{ fontFamily: 'serif', textShadow: '0 2px 8px #000' }}>
                ⚔️ COMBAT
              </div>
            </div>
          )}

          {/* result banner */}
          {phase === 'result' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 animate-in fade-in">
              <div className="text-6xl mb-1">{result.victory ? '🏆' : '💀'}</div>
              <div className={`text-4xl font-bold ${result.victory ? 'text-amber-300' : 'text-red-400'}`} style={{ fontFamily: 'serif', textShadow: '0 2px 10px #000' }}>
                {result.victory ? 'VICTOIRE' : 'DÉFAITE'}
              </div>
              <div className="flex gap-4 mt-3 text-sm font-bold">
                <span className="text-red-300">💀 Pertes : {lostTotal}/{sentTotal}</span>
                <span className="text-amber-300">⚔️ Ennemis tués : {enemyKilledFinal}/{enemyTotal}</span>
              </div>
            </div>
          )}
        </div>

        {/* Chest + rewards panel — click the chest to open the loot summary */}
        {phase === 'result' && (
          <div className="mt-3 bg-[#1a0a2e] border border-amber-500/40 rounded-xl p-4 animate-in slide-in-from-bottom">
            {!chestOpened ? (
              <div className="text-center">
                <button
                  onClick={() => setChestOpened(true)}
                  className="group mx-auto block rounded-xl p-2 hover:bg-amber-500/10 transition-all"
                  aria-label="Ouvrir le coffre"
                >
                  <img
                    src="/loot/chest_closed.png"
                    alt="Coffre fermé"
                    className="mx-auto max-h-44 w-auto object-contain transition-transform group-hover:scale-105"
                    style={{ imageRendering: 'auto', filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.55))' }}
                  />
                </button>
                <div className="text-amber-300 font-bold mt-1">🎁 Coffre de fin de combat</div>
                <div className="text-amber-200/50 text-xs">Clique sur le coffre pour voir le résumé du butin gagné.</div>
              </div>
            ) : (
              <div className="animate-in fade-in zoom-in-95">
                <img
                  src="/loot/chest_open.png"
                  alt="Coffre ouvert"
                  className="mx-auto max-h-40 w-auto object-contain mb-2"
                  style={{ imageRendering: 'auto', filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.55))' }}
                />
                {result.floor && <div className="text-center text-amber-300 mb-2">Étage {result.floor} atteint</div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-3">
                  <div className="bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-amber-200">🏆 Renommée +{result.renownGained}</div>
                  {result.xpGained > 0 && <div className="bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-amber-200">📊 XP +{result.xpGained}</div>}
                  {result.resourcesGained && Object.entries(result.resourcesGained).filter(([, v]) => (v as number) > 0).map(([k, v]) => (
                    <div key={k} className="bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-2 text-amber-200">
                      {RES_ICON[k] || ''} {RES_NAME[k] || k} +{v as number}
                    </div>
                  ))}
                </div>
                {result.specialDrop ? (
                  <div className="rounded-lg border border-purple-500/50 bg-purple-950/25 p-3 mb-3">
                    <div className="flex items-center gap-3">
                      {result.specialDrop.icon || result.specialDrop.effects?.__icon ? (
                        <img src={result.specialDrop.icon || result.specialDrop.effects.__icon} alt="" className="h-14 w-14 object-contain rounded bg-black/30 border border-purple-400/30" />
                      ) : <div className="text-3xl">🛡️</div>}
                      <div className="min-w-0 flex-1">
                        <div className="text-purple-200 font-bold text-sm">{result.specialDrop.name} ({result.specialDrop.rarity})</div>
                        <div className="text-purple-100/60 text-xs">
                          {Object.entries(result.specialDrop.effects || {})
                            .filter(([k, v]) => !k.startsWith('__') && typeof v === 'number' && (v as number) > 0)
                            .map(([k, v]) => `+${v} ${STAT_NAME[k] || k}`).join(' • ')}
                        </div>
                        {(result.specialDrop.bonusText || result.specialDrop.effects?.__bonus) && (
                          <div className="text-purple-100/45 text-xs mt-1">Bonus appliqué : {result.specialDrop.bonusText || result.specialDrop.effects.__bonus}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-amber-200/40 text-xs mb-3">Aucune armure rare dans ce coffre cette fois.</div>
                )}
                {result.campaignBossItem && (
                  <div className="rounded-lg border border-red-500/50 bg-red-950/25 p-3 mb-3">
                    <div className="flex items-center gap-3">
                      {result.campaignBossItem.icon ? (
                        <img src={result.campaignBossItem.icon} alt="" className="h-14 w-14 object-contain rounded bg-black/30 border border-red-400/30" />
                      ) : <div className="text-3xl">🏆</div>}
                      <div className="min-w-0 flex-1">
                        <div className="text-red-200 font-bold text-sm">🏆 Objet de boss obtenu</div>
                        <div className="text-amber-200 text-sm font-bold">{result.campaignBossItem.name}</div>
                        <div className="text-red-100/45 text-xs mt-0.5">Ajouté à ton inventaire « Butin ». Sert aux crafts.</div>
                      </div>
                    </div>
                  </div>
                )}
                <button onClick={onClose}
                  className="w-full bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-50 py-2 rounded-lg font-bold transition-all">
                  Continuer
                </button>
              </div>
            )}
          </div>
        )}

        {/* skip while fighting */}
        {phase !== 'result' && (
          <div className="mt-3 text-center">
            <button onClick={() => setPhase('result')} className="text-amber-500/60 hover:text-amber-300 text-xs underline">
              Passer l'animation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const RES_ICON: Record<string, string> = {
  stone: '🪨', iron: '⛏️', gold: '🪙', food: '🌾', wood: '🪵', magic_energy: '✨',
};

const RES_NAME: Record<string, string> = {
  stone: 'Pierre', iron: 'Fer', gold: 'Or', food: 'Nourriture', wood: 'Bois', magic_energy: 'Énergie magique',
};

const STAT_NAME: Record<string, string> = {
  attack: 'Attaque', defense: 'Défense', hp: 'PV', magic: 'Magie', speed: 'Vitesse', crit: 'Critique',
};
