// ============================================================
// COOP COMBAT — combat coopératif tour par tour, serveur-autoritatif.
// Chaque joueur du salon joue SON héros à son tour. Ordre d'un round :
//   héros joueur 1 → héros joueur 2 → ... → ennemi → troupes (pool) → round suivant.
// Si un joueur ne joue pas avant le timeout, son héros auto-attaque.
// L'état vit en mémoire (Map), le combat est éphémère.
// ============================================================

import { TROOPS, TroopType, TroopRole, troopStatsAtLevel } from './gameEngine.js';

export interface CoopSkillSpec {
  id: string; name: string; icon: string;
  kind: 'attack' | 'magic' | 'stun' | 'heal' | 'buff' | 'defense';
  cooldown: number;
  value: (lvl: number, hero: CoopHero) => number;
}

// Miroir serveur des compétences de combat (mêmes effets que le client).
export const COOP_SKILLS: CoopSkillSpec[] = [
  { id: 'power_strike', name: 'Frappe puissante', icon: '💥', kind: 'attack', cooldown: 2, value: (l, h) => Math.round(h.attack * (1 + l * 0.25)) },
  { id: 'arcane_blast', name: 'Déflagration arcanique', icon: '🔮', kind: 'magic', cooldown: 3, value: (l, h) => Math.round((h.magic + 10) * (1 + l * 0.4)) },
  { id: 'shield_bash', name: 'Coup de bouclier', icon: '🛡️', kind: 'stun', cooldown: 4, value: (l, h) => Math.round(h.attack * (0.6 + l * 0.1)) },
  { id: 'heal_light', name: 'Lumière guérisseuse', icon: '✨', kind: 'heal', cooldown: 3, value: (l, h) => Math.round((h.hp * 0.12) * (1 + l * 0.15)) },
  { id: 'war_cry', name: 'Cri de guerre', icon: '📯', kind: 'buff', cooldown: 3, value: (l) => 0.10 + l * 0.04 },
  { id: 'iron_wall', name: 'Mur de fer', icon: '🧱', kind: 'defense', cooldown: 3, value: (l) => 0.12 + (0.80 - 0.12) * ((Math.max(1, l) - 1) / 39) },
  { id: 'regeneration', name: 'Régénération', icon: '💚', kind: 'heal', cooldown: 4, value: (l, h) => Math.round((h.hp * 0.08) * (1 + l * 0.2)) },
  { id: 'berserker', name: 'Berserker', icon: '🔥', kind: 'attack', cooldown: 3, value: (l, h) => Math.round(h.attack * (0.8 + l * 0.15)) },
];
const SKILL_BY_ID: Record<string, CoopSkillSpec> = Object.fromEntries(COOP_SKILLS.map(s => [s.id, s]));

export interface CoopHero {
  playerId: string;
  name: string;
  attack: number; defense: number; hp: number; magic: number; level: number;
  maxHp: number;
  curHp: number;
  alive: boolean;
  skillLevels: Record<string, number>;
  cooldowns: Record<string, number>;
}

interface Side {
  label: string; maxHp: number; hp: number;
  atkBuff: number; atkBuffTurns: number;
  defBuff: number; defBuffTurns: number;
  stunned: number;
}

interface TroopUnit { type: string; count: number; level: number; role: TroopRole; atk: number; }

export interface CoopCombatState {
  roomId: string;
  turnOrder: string[];        // playerIds dans l'ordre de jeu
  activeIndex: number;        // index dans turnOrder du joueur dont c'est le tour
  phase: 'hero' | 'enemy' | 'troops' | 'won' | 'lost';
  round: number;
  heroes: Record<string, CoopHero>;
  ally: Side;
  enemy: Side;
  troops: TroopUnit[];
  enemyTroops: { type: string; count: number }[];
  log: { round: number; actor: string; text: string; dmg?: number; heal?: number }[];
  deadline: number;           // timestamp (ms) limite pour le joueur actif
}

const STATES = new Map<string, CoopCombatState>();
export const TURN_TIMEOUT_MS = 30000;

export function getCoopState(roomId: string) { return STATES.get(roomId); }
export function clearCoopState(roomId: string) { STATES.delete(roomId); }

function pushLog(s: CoopCombatState, e: { actor: string; text: string; dmg?: number; heal?: number }) {
  s.log = [...s.log, { round: s.round, ...e }].slice(-50);
}

// Construit l'état de combat coop initial.
export function initCoopCombat(opts: {
  roomId: string;
  members: { playerId: string; name: string; troops: Record<string, number>; troopLevels: Record<string, number>;
             hero: { attack: number; defense: number; hp: number; magic: number; level: number }; skillLevels: Record<string, number> }[];
  enemyTroops: { type: string; count: number }[];
  enemyHero: { level: number; attack: number; defense: number; hp: number };
  enemyLabel: string;
}): CoopCombatState {
  const heroes: Record<string, CoopHero> = {};
  const turnOrder: string[] = [];
  for (const m of opts.members) {
    const maxHp = Math.round(m.hero.hp);
    heroes[m.playerId] = {
      playerId: m.playerId, name: m.name,
      attack: m.hero.attack, defense: m.hero.defense, hp: m.hero.hp, magic: m.hero.magic, level: m.hero.level,
      maxHp, curHp: maxHp, alive: true,
      skillLevels: m.skillLevels || {}, cooldowns: {},
    };
    turnOrder.push(m.playerId);
  }

  // Pool de toutes les troupes de l'équipe.
  const pooled: Record<string, { count: number; level: number }> = {};
  for (const m of opts.members) {
    for (const [type, count] of Object.entries(m.troops)) {
      if (!count || !TROOPS[type as TroopType]) continue;
      const lvl = m.troopLevels[type] || 1;
      if (!pooled[type]) pooled[type] = { count: 0, level: lvl };
      pooled[type].count += count;
      pooled[type].level = Math.max(pooled[type].level, lvl);
    }
  }
  const troops: TroopUnit[] = Object.entries(pooled).map(([type, v]) => {
    const d = TROOPS[type as TroopType];
    const st = troopStatsAtLevel(type as TroopType, v.level);
    return { type, count: v.count, level: v.level, role: d.role, atk: Math.round(st.attack) };
  });
  let allyHp = 0;
  for (const [type, v] of Object.entries(pooled)) {
    const st = troopStatsAtLevel(type as TroopType, v.level);
    allyHp += st.hp * v.count;
  }
  allyHp = Math.max(1, Math.round(allyHp));

  let enemyHp = opts.enemyHero.hp;
  for (const e of opts.enemyTroops) {
    const d = TROOPS[e.type as TroopType];
    enemyHp += (d ? d.hp : 60) * e.count;
  }
  enemyHp = Math.max(1, Math.round(enemyHp * 1.1));
  // Combat à plusieurs : vie du monstre = vie initiale + vie initiale * 0.5 * nombre de joueurs.
  const partySize = opts.members.length;
  enemyHp = Math.max(1, Math.round(enemyHp + enemyHp * 0.5 * partySize));

  const state: CoopCombatState = {
    roomId: opts.roomId,
    turnOrder, activeIndex: 0,
    phase: 'hero', round: 1,
    heroes,
    ally: { label: 'Troupes', maxHp: allyHp, hp: allyHp, atkBuff: 0, atkBuffTurns: 0, defBuff: 0, defBuffTurns: 0, stunned: 0 },
    enemy: { label: opts.enemyLabel, maxHp: enemyHp, hp: enemyHp, atkBuff: 0, atkBuffTurns: 0, defBuff: 0, defBuffTurns: 0, stunned: 0 },
    troops, enemyTroops: opts.enemyTroops,
    log: [{ round: 1, actor: 'system', text: `⚔️ Combat d'équipe contre ${opts.enemyLabel} ! ${turnOrder.length} héros engagés.` }],
    deadline: Date.now() + TURN_TIMEOUT_MS,
  };
  STATES.set(opts.roomId, state);
  return state;
}

function totalTroopAttack(s: CoopCombatState): number {
  let base = 0;
  for (const u of s.troops) {
    let a = u.atk * u.count;
    switch (u.role) {
      case 'mage': a *= 1.5; break;
      case 'assassin': a *= 1.4; break;
      case 'ranged': a *= 1.25; break;
      case 'cavalry': a *= (s.ally.hp > s.ally.maxHp * 0.5 ? 1.5 : 1.1); break;
      case 'tank': a *= 0.7; break;
    }
    base += a;
  }
  return Math.round(base * (1 + s.ally.atkBuff));
}
function paralyzeChance(s: CoopCombatState): number {
  // Elfe : 10% au niveau 1, +2% par niveau, plafond 30% (atteint au niveau 10).
  let lvl = 0;
  for (const t of s.troops) if (t.role === 'paralyze' && t.count > 0) lvl = Math.max(lvl, t.level);
  if (lvl <= 0) return 0;
  return Math.min(0.30, 0.08 + lvl * 0.02);
}
function evadeChance(s: CoopCombatState): number {
  // Cowboy : 20% au niveau 1, +2% par niveau, plafond 40% (atteint au niveau 10).
  let lvl = 0;
  for (const t of s.troops) if (t.role === 'evade' && t.count > 0) lvl = Math.max(lvl, t.level);
  if (lvl <= 0) return 0;
  return Math.min(0.40, 0.18 + lvl * 0.02);
}
function enemyAttackPower(s: CoopCombatState): number {
  const eh = 12 + s.round * 2;
  let tp = 0;
  for (const e of s.enemyTroops) { const d = TROOPS[e.type as TroopType]; tp += (d ? d.attack : 12) * e.count; }
  // Plus de joueurs = plus d'ennemis frappés ; on intensifie un peu par héros vivant.
  const aliveHeroes = Object.values(s.heroes).filter(h => h.alive).length || 1;
  return Math.round((eh + tp) * 0.5 * (1 + (aliveHeroes - 1) * 0.15));
}

function activePlayerId(s: CoopCombatState): string | null {
  if (s.phase !== 'hero') return null;
  return s.turnOrder[s.activeIndex] || null;
}

// Passe au héros vivant suivant ; si plus aucun, on enchaîne l'ennemi.
function advanceHeroTurn(s: CoopCombatState) {
  for (let step = 1; step <= s.turnOrder.length; step++) {
    const idx = s.activeIndex + step;
    if (idx >= s.turnOrder.length) break;
    if (s.heroes[s.turnOrder[idx]]?.alive) { s.activeIndex = idx; s.deadline = Date.now() + TURN_TIMEOUT_MS; return; }
  }
  // plus de héros à jouer ce round → tour ennemi
  s.phase = 'enemy';
}

// Un héros joue (compétence ou attaque de base).
export function coopHeroAction(s: CoopCombatState, playerId: string, skillId: string | 'basic'): { ok: boolean; error?: string } {
  if (s.phase !== 'hero') return { ok: false, error: 'Pas la phase héros' };
  if (activePlayerId(s) !== playerId) return { ok: false, error: 'Pas ton tour' };
  const hero = s.heroes[playerId];
  if (!hero || !hero.alive) { advanceHeroTurn(s); return { ok: false, error: 'Héros à terre' }; }

  if (skillId === 'basic') {
    const dmg = Math.round(hero.attack * (1 + Math.random() * 0.2));
    s.enemy.hp = Math.max(0, s.enemy.hp - dmg);
    pushLog(s, { actor: 'hero', text: `${hero.name} frappe pour ${dmg} dégâts.`, dmg });
  } else {
    const spec = SKILL_BY_ID[skillId];
    const lvl = hero.skillLevels[skillId] || 0;
    if (!spec || lvl <= 0) return { ok: false, error: 'Compétence indisponible' };
    if ((hero.cooldowns[skillId] || 0) > 0) return { ok: false, error: 'Compétence en recharge' };
    const val = spec.value(lvl, hero);
    hero.cooldowns[skillId] = spec.cooldown;
    switch (spec.kind) {
      case 'attack': {
        const bonus = spec.id === 'berserker' && hero.curHp < hero.maxHp * 0.4 ? Math.round(val * 0.6) : 0;
        const total = val + bonus;
        s.enemy.hp = Math.max(0, s.enemy.hp - total);
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : ${total} dégâts${bonus ? ' (rage !)' : ''}.`, dmg: total });
        break;
      }
      case 'magic': {
        s.enemy.hp = Math.max(0, s.enemy.hp - val);
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : ${val} dégâts magiques.`, dmg: val });
        break;
      }
      case 'stun': {
        s.enemy.hp = Math.max(0, s.enemy.hp - val);
        // Coup de bouclier : 40% d'étourdissement au niveau 1, +2% par niveau, plafond 70%.
        const stunChance = 0.40 + (0.78 - 0.40) * ((Math.min(20, lvl) - 1) / 19);
        if (Math.random() < stunChance) {
          s.enemy.stunned = Math.max(s.enemy.stunned, 1);
          pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : ${val} dégâts, ennemi étourdi !`, dmg: val });
        } else {
          pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : ${val} dégâts (étourdissement raté).`, dmg: val });
        }
        break;
      }
      case 'heal': {
        s.ally.hp = Math.min(s.ally.maxHp, s.ally.hp + val);
        hero.curHp = Math.min(hero.maxHp, hero.curHp + Math.round(val * 0.5));
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : +${val} PV à l'armée.`, heal: val });
        break;
      }
      case 'buff': {
        s.ally.atkBuff = Math.max(s.ally.atkBuff, val); s.ally.atkBuffTurns = 3;
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : +${Math.round(val * 100)}% attaque (3 tours).` });
        break;
      }
      case 'defense': {
        s.ally.defBuff = Math.min(0.85, Math.max(s.ally.defBuff, val)); s.ally.defBuffTurns = 2;
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${hero.name} — ${spec.name} : -${Math.round(val * 100)}% dégâts subis (2 tours).` });
        break;
      }
    }
  }

  if (s.enemy.hp <= 0) { s.phase = 'won'; pushLog(s, { actor: 'system', text: '🏆 Ennemi vaincu !' }); return { ok: true }; }
  advanceHeroTurn(s);
  return { ok: true };
}

// Tour ennemi : frappe troupes ou un héros vivant au hasard.
export function coopEnemyAction(s: CoopCombatState) {
  if (s.phase !== 'enemy') return;
  if (s.enemy.stunned > 0) {
    s.enemy.stunned -= 1;
    pushLog(s, { actor: 'enemy', text: '😵 L\'ennemi est étourdi et passe son tour.' });
  } else {
    let dmg = enemyAttackPower(s) + Math.round(Math.random() * 10);
    if (s.ally.defBuffTurns > 0) dmg = Math.round(dmg * (1 - s.ally.defBuff));
    // L'ennemi cible D'ABORD les troupes ; il ne vise les héros que lorsqu'il n'y a plus de troupes.
    if (s.ally.hp > 0) {
      if (Math.random() < evadeChance(s)) {
        pushLog(s, { actor: 'troops', text: '🤠 Tes tireurs esquivent complètement l\'attaque !' });
      } else {
        s.ally.hp = Math.max(0, s.ally.hp - dmg);
        pushLog(s, { actor: 'enemy', text: `👹 L'ennemi attaque les troupes : ${dmg} dégâts.`, dmg });
      }
    } else {
      // vise un héros vivant aléatoire
      const alive = Object.values(s.heroes).filter(h => h.alive);
      if (alive.length) {
        const target = alive[Math.floor(Math.random() * alive.length)];
        target.curHp = Math.max(0, target.curHp - dmg);
        if (target.curHp <= 0) { target.alive = false; pushLog(s, { actor: 'enemy', text: `👹 L'ennemi vise ${target.name} : ${dmg} dégâts. ${target.name} tombe !`, dmg }); }
        else pushLog(s, { actor: 'enemy', text: `👹 L'ennemi vise ${target.name} : ${dmg} dégâts.`, dmg });
      }
    }
  }
  const anyHeroAlive = Object.values(s.heroes).some(h => h.alive);
  if (!anyHeroAlive && s.ally.hp <= 0) { s.phase = 'lost'; pushLog(s, { actor: 'system', text: '💀 L\'équipe est anéantie.' }); return; }
  s.phase = 'troops';
}

// Tour des troupes (pool) — automatique, puis fin de round.
export function coopTroopsAction(s: CoopCombatState) {
  if (s.phase !== 'troops') return;
  if (s.ally.hp > 0 && s.troops.length > 0) {
    const dmg = totalTroopAttack(s);
    s.enemy.hp = Math.max(0, s.enemy.hp - dmg);
    pushLog(s, { actor: 'troops', text: `⚔️ Les troupes de l'équipe frappent : ${dmg} dégâts.`, dmg });
    if (s.enemy.hp > 0 && Math.random() < paralyzeChance(s)) {
      s.enemy.stunned = Math.max(s.enemy.stunned, 1);
      pushLog(s, { actor: 'troops', text: '🍃 Tes elfes paralysent l\'ennemi : il sautera son tour !' });
    }
  } else if (s.troops.length === 0) {
    pushLog(s, { actor: 'troops', text: 'Aucune troupe pour soutenir les héros.' });
  }

  // soin des soigneurs en fin de round
  let heal = 0;
  for (const u of s.troops) if (u.role === 'healer' || u.role === 'paladin') heal += u.count * (u.role === 'healer' ? 14 : 7);
  if (heal > 0 && s.ally.hp > 0) {
    s.ally.hp = Math.min(s.ally.maxHp, s.ally.hp + heal);
    for (const h of Object.values(s.heroes)) if (h.alive) h.curHp = Math.min(h.maxHp, h.curHp + Math.round(heal * 0.4 / s.turnOrder.length));
    pushLog(s, { actor: 'troops', text: `🙏 Tes prêtres soignent l'équipe : +${heal} PV.`, heal });
  }

  // décrément buffs + cooldowns
  if (s.ally.atkBuffTurns > 0) { s.ally.atkBuffTurns -= 1; if (s.ally.atkBuffTurns === 0) s.ally.atkBuff = 0; }
  if (s.ally.defBuffTurns > 0) { s.ally.defBuffTurns -= 1; if (s.ally.defBuffTurns === 0) s.ally.defBuff = 0; }
  for (const h of Object.values(s.heroes)) for (const k of Object.keys(h.cooldowns)) if (h.cooldowns[k] > 0) h.cooldowns[k] -= 1;

  if (s.enemy.hp <= 0) { s.phase = 'won'; pushLog(s, { actor: 'system', text: '🏆 Ennemi vaincu !' }); return; }

  // round suivant : repart au premier héros vivant
  s.round += 1;
  const firstAlive = s.turnOrder.findIndex(pid => s.heroes[pid]?.alive);
  if (firstAlive === -1) { s.phase = 'lost'; pushLog(s, { actor: 'system', text: '💀 Plus aucun héros debout.' }); return; }
  s.activeIndex = firstAlive;
  s.phase = 'hero';
  s.deadline = Date.now() + TURN_TIMEOUT_MS;
}

// Le tour actif a-t-il dépassé le délai ?
export function coopTurnExpired(s: CoopCombatState): boolean {
  return s.phase === 'hero' && Date.now() >= s.deadline;
}

// Vue publique de l'état (pour diffusion aux clients).
export function coopPublicState(s: CoopCombatState) {
  return {
    roomId: s.roomId, phase: s.phase, round: s.round,
    activePlayerId: activePlayerId(s),
    turnOrder: s.turnOrder,
    deadline: s.deadline,
    heroes: Object.values(s.heroes).map(h => ({
      playerId: h.playerId, name: h.name, curHp: h.curHp, maxHp: h.maxHp, alive: h.alive,
      cooldowns: h.cooldowns, skillLevels: h.skillLevels,
    })),
    ally: { hp: s.ally.hp, maxHp: s.ally.maxHp },
    enemy: { label: s.enemy.label, hp: s.enemy.hp, maxHp: s.enemy.maxHp, stunned: s.enemy.stunned },
    enemyTroops: s.enemyTroops,
    log: s.log,
  };
}

// Résultat final par membre, basé sur la survie de l'armée et le héros.
export function coopOutcome(s: CoopCombatState, members: { playerId: string; troops: Record<string, number> }[]) {
  const victory = s.phase === 'won';
  const survivalRate = victory
    ? Math.max(0.3, s.ally.hp / s.ally.maxHp)
    : Math.max(0, s.ally.hp / s.ally.maxHp) * 0.4;
  const perMemberSurvivors = members.map(m => {
    const surv: Record<string, number> = {};
    for (const [t, c] of Object.entries(m.troops)) surv[t] = Math.max(0, Math.floor(c * survivalRate));
    return surv;
  });
  return { victory, perMemberSurvivors };
}
