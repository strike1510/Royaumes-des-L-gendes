// ============================================================
// Moteur de combat TOUR PAR TOUR (client).
// Ordre d'un tour : 1) Héros (action choisie par le joueur)
//                   2) Ennemi (IA)
//                   3) Troupes alliées (frappent EN DERNIER, auto)
// Le serveur applique le résultat final tel quel (victory + survivants).
// ============================================================

import { TROOP_DATA, troopStatsAtLevel, type TroopRole } from '@/lib/gameData';

// ---- Compétences héros utilisables en combat ----
export interface SkillSpec {
  id: string;
  name: string;
  icon: string;
  desc: string;
  maxLevel: number;
  cooldown: number;          // tours de recharge
  kind: 'attack' | 'heal' | 'buff' | 'defense' | 'magic' | 'stun';
  // valeur de l'effet selon le niveau de compétence et la magie/attaque du héros
  value: (skillLevel: number, hero: HeroStats) => number;
}

export interface HeroStats {
  name: string;
  level: number;
  attack: number;
  defense: number;
  hp: number;
  magic: number;
  critChance?: number;   // 0..1 chance d'un coup critique (attaques du héros)
  critMult?: number;     // multiplicateur de dégâts en cas de critique (x1.1 → x2.5)
}

export const COMBAT_SKILLS: SkillSpec[] = [
  { id: 'power_strike', name: 'Frappe puissante', icon: '💥', desc: 'Gros dégâts physiques sur l\'ennemi', maxLevel: 40, cooldown: 1,
    kind: 'attack', value: (lv, h) => Math.round(h.attack * (1.3 + lv * 0.18)) },
  { id: 'arcane_blast', name: 'Déflagration arcanique', icon: '🔮', desc: 'Dégâts magiques perçant la défense', maxLevel: 40, cooldown: 2,
    kind: 'magic', value: (lv, h) => Math.round((h.magic + 8) * (1.5 + lv * 0.22)) },
  { id: 'heal_light', name: 'Lumière guérisseuse', icon: '💚', desc: 'Soigne les PV de l\'armée', maxLevel: 40, cooldown: 2,
    kind: 'heal', value: (lv, h) => Math.round((h.magic + 20) * (1 + lv * 0.3)) },
  // Cri de guerre : +4%/niv, jusqu'à +160% au niv.40 (croissance constante, jamais capé avant le max).
  { id: 'war_cry', name: 'Cri de guerre', icon: '📯', desc: 'Augmente l\'attaque des troupes (3 tours)', maxLevel: 40, cooldown: 3,
    kind: 'buff', value: (lv) => 0.10 + lv * 0.04 },
  // Mur de fer : réduction des dégâts qui monte régulièrement jusqu'au niv.40.
  // 14% au niv.1 → 80% au niv.40 (+~1,7%/niv), donc chaque niveau sert vraiment.
  { id: 'iron_wall', name: 'Mur de fer', icon: '🛡️', desc: 'Réduit les dégâts subis (2 tours)', maxLevel: 40, cooldown: 3,
    kind: 'defense', value: (lv) => 0.12 + (0.80 - 0.12) * ((lv - 1) / 39) },
  // Coup de bouclier : dégâts ET chance d'étourdir montent jusqu'au niv.20.
  { id: 'shield_bash', name: 'Coup de bouclier', icon: '🔨', desc: 'Dégâts + chance d\'étourdir l\'ennemi 1 tour (40%→78%)', maxLevel: 20, cooldown: 3,
    kind: 'stun', value: (lv, h) => Math.round(h.attack * (0.8 + lv * 0.1)) },
  { id: 'regeneration', name: 'Régénération', icon: '❤️‍🩹', desc: 'Soin léger continu (gros sur la durée)', maxLevel: 40, cooldown: 4,
    kind: 'heal', value: (lv, h) => Math.round((h.magic + 10) * (0.8 + lv * 0.2)) },
  { id: 'berserker', name: 'Berserker', icon: '💢', desc: 'Énorme frappe, plus forte si PV bas', maxLevel: 20, cooldown: 3,
    kind: 'attack', value: (lv, h) => Math.round(h.attack * (1.5 + lv * 0.25)) },
];

export const SKILL_BY_ID: Record<string, SkillSpec> = Object.fromEntries(COMBAT_SKILLS.map(s => [s.id, s]));

// ---- État de combat ----
export interface CombatantSide {
  label: string;
  maxHp: number;
  hp: number;
  // multiplicateurs temporaires
  atkBuff: number;       // % attaque troupes
  atkBuffTurns: number;
  defBuff: number;       // % réduction dégâts
  defBuffTurns: number;
  stunned: number;       // tours d'étourdissement restants
}

export interface TroopUnit {
  type: string;
  count: number;
  level: number;
  role: TroopRole;
  atk: number;           // attaque par unité (niveau appliqué)
  hp: number;            // PV agrégés restants de ce groupe
  maxHp: number;         // PV agrégés max de ce groupe
}

export interface CombatState {
  turn: number;
  phase: 'hero' | 'enemy' | 'troops' | 'won' | 'lost';
  log: CombatLogEntry[];
  hero: HeroStats;
  heroHp: number;
  heroMaxHp: number;
  ally: CombatantSide;   // "santé" agrégée des troupes alliées
  enemy: CombatantSide;
  troops: TroopUnit[];
  enemyTroops: { type: string; count: number }[];
  skillCooldowns: Record<string, number>;
  skillLevels: Record<string, number>;
}

export interface CombatLogEntry {
  turn: number;
  actor: 'hero' | 'enemy' | 'troops' | 'system';
  text: string;
  dmg?: number;
  heal?: number;
}

// Construit l'état initial à partir des données joueur/ennemi.
export function initCombat(opts: {
  hero: HeroStats;
  heroSkillLevels: Record<string, number>;
  troops: { type: string; count: number; level: number }[];
  enemyTroops: { type: string; count: number }[];
  enemyHero: { level: number; attack: number; defense: number; hp: number };
  enemyLabel?: string;
}): CombatState {
  const { hero, troops, enemyTroops, enemyHero } = opts;

  // PV agrégés des troupes alliées = somme des PV (niveau appliqué).
  const allyUnits: TroopUnit[] = troops
    .filter(t => t.count > 0 && TROOP_DATA[t.type])
    .map(t => {
      const d = TROOP_DATA[t.type];
      const s = troopStatsAtLevel(d, t.level || 1);
      const groupHp = Math.max(1, Math.round(s.hp * t.count));
      return { type: t.type, count: t.count, level: t.level || 1, role: d.role, atk: s.attack, hp: groupHp, maxHp: groupHp };
    });
  let allyHp = 0;
  for (const t of troops) {
    const d = TROOP_DATA[t.type];
    if (!d) continue;
    const s = troopStatsAtLevel(d, t.level || 1);
    allyHp += s.hp * t.count;
  }
  allyHp = Math.max(1, Math.round(allyHp));

  // PV ennemis agrégés.
  let enemyHp = enemyHero.hp;
  for (const e of enemyTroops) {
    const d = TROOP_DATA[e.type];
    enemyHp += (d ? d.hp : 60) * e.count;
  }
  enemyHp = Math.max(1, Math.round(enemyHp * 1.1));

  const heroMaxHp = Math.round(hero.hp);

  return {
    turn: 1,
    phase: 'hero',
    log: [{ turn: 1, actor: 'system', text: `⚔️ Le combat commence contre ${opts.enemyLabel || 'l\'ennemi'} !` }],
    hero,
    heroHp: heroMaxHp,
    heroMaxHp,
    ally: { label: 'Troupes', maxHp: allyHp, hp: allyHp, atkBuff: 0, atkBuffTurns: 0, defBuff: 0, defBuffTurns: 0, stunned: 0 },
    enemy: { label: opts.enemyLabel || 'Ennemi', maxHp: enemyHp, hp: enemyHp, atkBuff: 0, atkBuffTurns: 0, defBuff: 0, defBuffTurns: 0, stunned: 0 },
    troops: allyUnits,
    enemyTroops,
    skillCooldowns: {},
    skillLevels: opts.heroSkillLevels || {},
  };
}

function totalTroopAttack(s: CombatState): number {
  let base = 0;
  for (const u of s.troops) {
    if (u.hp <= 0) continue; // un groupe anéanti ne frappe plus
    let a = u.atk * u.count;
    // atouts de rôle
    switch (u.role) {
      case 'mage': a *= 1.5; break;
      case 'assassin': a *= 1.4; break;
      case 'ranged': a *= 1.25; break;
      case 'cavalry': a *= (allyHpTotal(s) > allyMaxHpTotal(s) * 0.5 ? 1.5 : 1.1); break;
      case 'tank': a *= 0.7; break;
      default: break;
    }
    base += a;
  }
  base *= (1 + s.ally.atkBuff);
  return Math.round(base);
}

// Somme des PV restants / max de tous les groupes alliés.
function allyHpTotal(s: CombatState): number {
  return s.troops.reduce((sum, u) => sum + Math.max(0, u.hp), 0);
}
function allyMaxHpTotal(s: CombatState): number {
  return s.troops.reduce((sum, u) => sum + Math.max(0, u.maxHp), 0);
}

// Golem : réduit les attaques ennemies d'un pourcentage (12% niv.1 → 30% niv.10).
// Le meilleur golem vivant donne la réduction.
function golemReduction(s: CombatState): number {
  let lvl = 0;
  for (const u of s.troops) if (u.type === 'golem' && u.count > 0 && u.hp > 0) lvl = Math.max(lvl, u.level);
  if (lvl <= 0) return 0;
  return Math.min(0.30, 0.10 + lvl * 0.02);
}

// Part des PV alliés portée par les cowboys (sert à l'esquive partielle "pour eux-mêmes").
function cowboyHpShare(s: CombatState): number {
  const total = allyHpTotal(s);
  if (total <= 0) return 0;
  const cow = s.troops.filter(u => u.type === 'mage_guard' && u.hp > 0).reduce((sum, u) => sum + u.hp, 0);
  return cow / total;
}

// Applique `dmg` aux groupes alliés. Le Nain (knight) encaisse EN PREMIER :
// tant qu'il reste des nains vivants, ils prennent tous les dégâts. Ensuite
// les autres groupes, puis enfin le bouclier agrégé `s.ally`.
function distributeDamageToTroops(s: CombatState, dmg: number): number {
  let remaining = dmg;
  const order = [
    ...s.troops.filter(u => u.type === 'knight' && u.hp > 0),   // Nains d'abord
    ...s.troops.filter(u => u.type !== 'knight' && u.hp > 0),   // puis le reste
  ];
  for (const u of order) {
    if (remaining <= 0) break;
    const absorbed = Math.min(u.hp, remaining);
    u.hp -= absorbed;
    remaining -= absorbed;
  }
  // Synchronise le bouclier agrégé sur la somme des PV de groupes.
  s.ally.hp = allyHpTotal(s);
  return remaining; // dégâts qui débordent (plus aucune troupe vivante)
}

// Soigne les groupes alliés vivants, réparti proportionnellement à leurs PV max.
function healTroops(s: CombatState, amount: number) {
  const alive = s.troops.filter(u => u.hp > 0);
  const totalMax = alive.reduce((sum, u) => sum + u.maxHp, 0);
  if (totalMax <= 0 || amount <= 0) { s.ally.hp = allyHpTotal(s); return; }
  for (const u of alive) {
    const share = Math.round(amount * (u.maxHp / totalMax));
    u.hp = Math.min(u.maxHp, u.hp + share);
  }
  s.ally.hp = allyHpTotal(s);
}

// Chance que les troupes paralysent l'ennemi ce tour (rôle paralyze / elfe).
// Elfe : 10% au niveau 1, +2% par niveau, plafond 30% (niveau 10).
function paralyzeChance(s: CombatState): number {
  let lvl = 0;
  for (const u of s.troops) if (u.role === 'paralyze' && u.count > 0) lvl = Math.max(lvl, u.level);
  if (lvl <= 0) return 0;
  return Math.min(0.30, 0.08 + lvl * 0.02);
}

// Chance que l'armée esquive une attaque (rôle evade / cowboy).
// Cowboy : 20% au niveau 1, +2% par niveau, plafond 40% (niveau 10).
function evadeChance(s: CombatState): number {
  let lvl = 0;
  for (const u of s.troops) if (u.role === 'evade' && u.count > 0 && u.hp > 0) lvl = Math.max(lvl, u.level);
  if (lvl <= 0) return 0;
  return Math.min(0.40, 0.18 + lvl * 0.02);
}

function enemyAttackPower(s: CombatState): number {
  const eh = 12 + s.turn * 2;
  let troopsP = 0;
  for (const e of s.enemyTroops) {
    const d = TROOP_DATA[e.type];
    troopsP += (d ? d.attack : 12) * e.count;
  }
  return Math.round((eh + troopsP) * 0.5);
}

function pushLog(s: CombatState, e: Omit<CombatLogEntry, 'turn'>) {
  s.log = [...s.log, { turn: s.turn, ...e }].slice(-40);
}

// Le joueur joue une compétence (ou attaque de base). Renvoie un NOUVEL état.
export function heroAction(state: CombatState, skillId: string | 'basic'): CombatState {
  if (state.phase !== 'hero') return state;
  const s: CombatState = structuredClone(state);

  if (skillId === 'basic') {
    const raw = Math.round(s.hero.attack * (1 + Math.random() * 0.2));
    const cc = s.hero.critChance || 0;
    const cm = s.hero.critMult || 1.1;
    const isCrit = Math.random() < cc;
    const dmg = isCrit ? Math.round(raw * cm) : raw;
    s.enemy.hp = Math.max(0, s.enemy.hp - dmg);
    if (isCrit) {
      pushLog(s, { actor: 'hero', text: `💥 CRITIQUE ! ${s.hero.name} frappe pour ${dmg} dégâts (base ${raw} × ${cm.toFixed(2)}).`, dmg });
    } else {
      pushLog(s, { actor: 'hero', text: `${s.hero.name} frappe pour ${dmg} dégâts (critique ${Math.round(cc * 100)}% raté).`, dmg });
    }
  } else {
    const spec = SKILL_BY_ID[skillId];
    const lvl = Math.min(spec?.maxLevel || 1, s.skillLevels[skillId] || 0);
    if (!spec || lvl <= 0) return state;
    if ((s.skillCooldowns[skillId] || 0) > 0) return state;

    const val = spec.value(lvl, s.hero);
    s.skillCooldowns[skillId] = spec.cooldown;

    switch (spec.kind) {
      case 'attack': {
        const bonus = spec.id === 'berserker' && s.heroHp < s.heroMaxHp * 0.4 ? Math.round(val * 0.6) : 0;
        const base = val + bonus;
        const cc = s.hero.critChance || 0;
        const cm = s.hero.critMult || 1.1;
        const isCrit = Math.random() < cc;
        const total = isCrit ? Math.round(base * cm) : base;
        s.enemy.hp = Math.max(0, s.enemy.hp - total);
        if (isCrit) {
          pushLog(s, { actor: 'hero', text: `💥 CRITIQUE ! ${spec.icon} ${spec.name} : ${total} dégâts (base ${base} × ${cm.toFixed(2)})${bonus ? ' (rage !)' : ''}.`, dmg: total });
        } else {
          pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : ${total} dégâts${bonus ? ' (rage !)' : ''}.`, dmg: total });
        }
        break;
      }
      case 'magic': {
        s.enemy.hp = Math.max(0, s.enemy.hp - val);
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : ${val} dégâts magiques.`, dmg: val });
        break;
      }
      case 'stun': {
        s.enemy.hp = Math.max(0, s.enemy.hp - val);
        // Coup de bouclier : 40% d'étourdissement au niveau 1, +2% par niveau, plafond 70%.
        const stunChance = 0.40 + (0.78 - 0.40) * ((lvl - 1) / 19);
        if (Math.random() < stunChance) {
          s.enemy.stunned = 1;
          pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : ${val} dégâts, ennemi étourdi !`, dmg: val });
        } else {
          pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : ${val} dégâts (étourdissement raté).`, dmg: val });
        }
        break;
      }
      case 'heal': {
        healTroops(s, val);
        s.heroHp = Math.min(s.heroMaxHp, s.heroHp + Math.round(val * 0.5));
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : +${val} PV à l'armée.`, heal: val });
        break;
      }
      case 'buff': {
        s.ally.atkBuff = val;
        s.ally.atkBuffTurns = 3;
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : +${Math.round(val * 100)}% attaque (3 tours).` });
        break;
      }
      case 'defense': {
        s.ally.defBuff = val;
        s.ally.defBuffTurns = 2;
        pushLog(s, { actor: 'hero', text: `${spec.icon} ${spec.name} : -${Math.round(val * 100)}% dégâts subis (2 tours).` });
        break;
      }
    }
  }

  if (s.enemy.hp <= 0) { s.phase = 'won'; pushLog(s, { actor: 'system', text: '🏆 Ennemi vaincu !' }); return s; }
  s.phase = 'enemy';
  return s;
}

// Tour ennemi (IA simple : frappe l'armée, parfois le héros).
export function enemyAction(state: CombatState): CombatState {
  if (state.phase !== 'enemy') return state;
  const s: CombatState = structuredClone(state);

  if (s.enemy.stunned > 0) {
    s.enemy.stunned -= 1;
    pushLog(s, { actor: 'enemy', text: '😵 L\'ennemi est étourdi et passe son tour.' });
  } else {
    const initial = enemyAttackPower(s) + Math.round(Math.random() * 10);
    let dmg = initial;
    const reductions: string[] = [];
    // Mur de fer (compétence héros) : réduction en %.
    if (s.ally.defBuffTurns > 0) {
      const before = dmg;
      dmg = Math.round(dmg * (1 - s.ally.defBuff));
      reductions.push(`🛡️ Mur de fer -${Math.round(s.ally.defBuff * 100)}% (-${before - dmg})`);
    }
    // Golem : réduit l'attaque ennemie d'un pourcentage.
    const gr = golemReduction(s);
    if (gr > 0) {
      const before = dmg;
      dmg = Math.round(dmg * (1 - gr));
      reductions.push(`🗿 Golems -${Math.round(gr * 100)}% (-${before - dmg})`);
    }
    // Annonce l'attaque initiale et le détail des réductions appliquées.
    pushLog(s, { actor: 'enemy', text: `👹 L'ennemi prépare ${initial} dégâts.${reductions.length ? ' Réductions : ' + reductions.join(', ') + '.' : ' Aucune réduction.'}` });
    // L'ennemi cible D'ABORD les troupes ; il ne vise le héros que lorsqu'il n'y a plus de troupes.
    if (allyHpTotal(s) > 0) {
      // Cowboy : esquive UNIQUEMENT pour lui-même. La part de dégâts qui
      // aurait frappé les cowboys est esquivée selon leur chance d'esquive.
      const cowShare = cowboyHpShare(s);
      if (cowShare > 0 && Math.random() < evadeChance(s)) {
        const dodged = Math.round(dmg * cowShare);
        dmg = Math.max(0, dmg - dodged);
        pushLog(s, { actor: 'troops', text: `🤠 Tes cowboys esquivent leur part de l'attaque (-${dodged}).` });
      }
      // Nain (knight) encaisse en premier, puis le reste des groupes.
      const overflow = distributeDamageToTroops(s, dmg);
      pushLog(s, { actor: 'enemy', text: `👹 ${dmg} dégâts encaissés par tes troupes.`, dmg });
      if (overflow > 0) {
        s.heroHp = Math.max(0, s.heroHp - overflow);
        pushLog(s, { actor: 'enemy', text: `👹 Le surplus touche ton héros : ${overflow} dégâts.`, dmg: overflow });
      }
    } else {
      s.heroHp = Math.max(0, s.heroHp - dmg);
      pushLog(s, { actor: 'enemy', text: `👹 L'ennemi vise ton héros : ${dmg} dégâts.`, dmg });
    }
  }

  if (s.heroHp <= 0 && allyHpTotal(s) <= 0) { s.phase = 'lost'; pushLog(s, { actor: 'system', text: '💀 Ton armée est anéantie.' }); return s; }
  s.phase = 'troops';
  return s;
}

// Tour des troupes alliées — EN DERNIER, automatique.
export function troopsAction(state: CombatState): CombatState {
  if (state.phase !== 'troops') return state;
  const s: CombatState = structuredClone(state);

  if (s.ally.hp > 0 && s.troops.length > 0) {
    const dmg = totalTroopAttack(s);
    s.enemy.hp = Math.max(0, s.enemy.hp - dmg);
    pushLog(s, { actor: 'troops', text: `⚔️ Tes troupes frappent en dernier : ${dmg} dégâts.`, dmg });
    // paralysie (elfe) : fait sauter le prochain tour ennemi
    if (s.enemy.hp > 0 && Math.random() < paralyzeChance(s)) {
      s.enemy.stunned = Math.max(s.enemy.stunned, 1);
      pushLog(s, { actor: 'troops', text: '🍃 Tes elfes paralysent l\'ennemi : il sautera son tour !' });
    }
  } else if (s.troops.length === 0) {
    pushLog(s, { actor: 'troops', text: 'Aucune troupe pour soutenir le héros.' });
  } else {
    pushLog(s, { actor: 'troops', text: 'Tes troupes sont à terre.' });
  }

  // fin de tour : soin des soigneurs (prêtre)
  let healPerTurn = 0;
  for (const u of s.troops) if (u.role === 'healer' || u.role === 'paladin') healPerTurn += u.count * (u.role === 'healer' ? 14 : 7);
  if (healPerTurn > 0 && allyHpTotal(s) > 0) {
    healTroops(s, healPerTurn);
    s.heroHp = Math.min(s.heroMaxHp, s.heroHp + Math.round(healPerTurn * 0.4));
    pushLog(s, { actor: 'troops', text: `🙏 Tes prêtres soignent l'armée : +${healPerTurn} PV.`, heal: healPerTurn });
  }

  // fin de tour : décrémente buffs + cooldowns
  if (s.ally.atkBuffTurns > 0) { s.ally.atkBuffTurns -= 1; if (s.ally.atkBuffTurns === 0) s.ally.atkBuff = 0; }
  if (s.ally.defBuffTurns > 0) { s.ally.defBuffTurns -= 1; if (s.ally.defBuffTurns === 0) s.ally.defBuff = 0; }
  for (const k of Object.keys(s.skillCooldowns)) if (s.skillCooldowns[k] > 0) s.skillCooldowns[k] -= 1;

  if (s.enemy.hp <= 0) { s.phase = 'won'; pushLog(s, { actor: 'system', text: '🏆 Ennemi vaincu !' }); return s; }

  s.turn += 1;
  s.phase = 'hero';
  return s;
}

// Résultat final à renvoyer au serveur.
export function combatOutcome(s: CombatState, originalTroops: { type: string; count: number; level: number }[]): {
  victory: boolean;
  survivingTroops: Record<string, number>;
} {
  const victory = s.phase === 'won';
  // Survivants calculés GROUPE PAR GROUPE selon les PV réels restants.
  // Les nains encaissent en premier → leur hp tombe à 0 avant les autres,
  // donc ils meurent bien d'abord.
  const survivingTroops: Record<string, number> = {};
  for (const t of originalTroops) {
    const unit = s.troops.find(u => u.type === t.type);
    if (!unit || unit.maxHp <= 0) { survivingTroops[t.type] = 0; continue; }
    const ratio = Math.max(0, unit.hp / unit.maxHp);
    // En cas de défaite, on garde un peu moins (déroute).
    const eff = victory ? ratio : ratio * 0.5;
    survivingTroops[t.type] = Math.min(t.count, Math.max(0, Math.round(t.count * eff)));
  }
  return { victory, survivingTroops };
}
