import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initDB, getDB, genId, ADMIN_USERNAME, listBackups, createBackup, restoreBackup, startAutoBackup, loadDifficultyConfig, saveDifficultyConfig } from './db.js';
import {
  RESOURCES, BUILDING_TYPES, BUILDINGS, TROOP_TYPES, TROOPS, TROOP_MAX_LEVEL, getTroopUpgradeCost,
  getTierForLevel, getTierConfig, getBuildingUpgradeCost, getMaxWorkers,
  getWorkerPoolCap, getWorkerPurchaseCost,
  getResourceCaps, calculateProduction, calculateConsumption,
  getTroopCost, heroXpForLevel, heroStatsForLevel, HERO_SKILLS,
  generateCampaignLevel, generateTowerFloor, resolveCombat,
  generateBoss, resolvePartyCombat, BOSS_NAMES, generateArmorDrop, generateBossSignatureDrop, bossSignatureDropChance,
  generateBasicEquipment, forgeCraftSeconds, generateGodArmor, generateGodSetPiece, GOD_SET_SLOTS, ARMOR_SLOT_NAMES,
  getPrestigeBonuses, RESEARCH_TYPES, RAID_COST, RAID_DEFENSE_BONUS,
  MARKET_FEE, RESOURCE_SELL_PRICES, SPECIAL_DROPS, CAMPAIGN_CHAPTERS, CAMPAIGN_EPISODES_PER_CHAPTER,
  getDifficulty, setDifficulty, resetDifficulty, DEFAULT_DIFFICULTY,
  type ResourceType, type BuildingType, type TroopType
} from './gameEngine.js';
import {
  initCoopCombat, coopHeroAction, coopEnemyAction, coopTroopsAction,
  coopPublicState, coopOutcome, coopTurnExpired, getCoopState, clearCoopState,
} from './coopCombat.js';

const PORT = Number(process.env.GAME_SERVER_PORT || 50007);
const HOST = process.env.GAME_SERVER_HOST || '0.0.0.0';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'game-server', port: PORT });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Timers de timeout des tours coop, partagés entre toutes les connexions.
const coopTimers = new Map<string, ReturnType<typeof setTimeout>>();


function getActiveMarketSellEvent() {
  const now = Math.floor(Date.now() / 1000);
  const events = db.prepare('SELECT * FROM seasonal_events WHERE start_date <= ? AND end_date > ? ORDER BY end_date ASC').all(now, now) as any[];
  for (const event of events) {
    try {
      const rewards = JSON.parse(event.rewards || '{}');
      if (Number(rewards.marketSellMultiplier || 0) > 0) {
        return { name: event.name, multiplier: Number(rewards.marketSellMultiplier) };
      }
    } catch {}
  }
  return { name: null, multiplier: 1 };
}

const db = initDB();
// Applique la config de difficulté sauvegardée (si présente).
try { const saved = loadDifficultyConfig(); if (saved) setDifficulty(saved); } catch {}

// =============================================
// HELPER FUNCTIONS (Bun SQLite API)
// =============================================

function getPlayerBySocket(socketId: string): any | null {
  return db.prepare('SELECT * FROM players WHERE socket_id = ?').get(socketId) as any;
}

// Crée un joueur complet (village, ressources, bâtiments, héros, progression).
// Réutilisé par l'inscription et la création de compte côté admin.
function createPlayerWorld(username: string, password: string): string {
  const playerId = genId();
  const villageId = genId();
  db.prepare('INSERT INTO players (id, username, password_hash, renown, prestige_count) VALUES (?, ?, ?, 0, 0)')
    .run(playerId, username, password);
  db.prepare('INSERT INTO villages (id, player_id, name, tier, town_hall_level) VALUES (?, ?, ?, 1, 1)')
    .run(villageId, playerId, `Village de ${username}`);
  db.prepare('INSERT INTO resources (id, village_id, stone, iron, gold, food, wood, magic_energy) VALUES (?, ?, 500, 300, 200, 400, 600, 100)')
    .run(genId(), villageId);
  const buildingTypes: BuildingType[] = ['town_hall', 'mine', 'lumberjack', 'farm', 'farm'];
  for (const type of buildingTypes) {
    const maxW = getMaxWorkers(type, 1);
    db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, ?, ?)')
      .run(genId(), villageId, type, type === 'town_hall' ? 0 : 2, maxW);
  }
  db.prepare('INSERT INTO troops (id, village_id, type, count, level) VALUES (?, ?, ?, 5, 1)')
    .run(genId(), villageId, 'soldier');
  db.prepare('INSERT INTO heroes (id, player_id, name, level, xp, skill_points, skills, attack, defense, hp, magic) VALUES (?, ?, ?, 1, 0, 1, ?, 10, 10, 100, 5)')
    .run(genId(), playerId, 'Héros', '{}');
  db.prepare('INSERT INTO campaign_progress (id, player_id, chapter, episode) VALUES (?, ?, 1, 1)')
    .run(genId(), playerId);
  db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor) VALUES (?, ?, 0, 0)')
    .run(genId(), playerId);
  return playerId;
}

function getVillageByPlayer(playerId: string): any {
  const v = db.prepare('SELECT * FROM villages WHERE player_id = ?').get(playerId) as any;
  if (v) {
    const owner = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId) as any;
    if (owner && owner.is_admin) { v.town_hall_level = 30; v.tier = getTierForLevel(30); }
  }
  return v;
}

function getResources(villageId: string): any {
  return db.prepare('SELECT * FROM resources WHERE village_id = ?').get(villageId) as any;
}

function getBuildings(villageId: string): any[] {
  return db.prepare('SELECT * FROM buildings WHERE village_id = ?').all(villageId) as any[];
}

function getTroops(villageId: string): any[] {
  return db.prepare('SELECT * FROM troops WHERE village_id = ?').all(villageId) as any[];
}

function getHero(playerId: string): any {
  return db.prepare('SELECT * FROM heroes WHERE player_id = ?').get(playerId) as any;
}

// ---- CONFIG GLOBALE (game_config, ligne unique id=1) ----
function getGameConfig(): Record<string, any> {
  const row = db.prepare('SELECT data FROM game_config WHERE id = 1').get() as any;
  if (!row) return {};
  try { return JSON.parse(row.data || '{}'); } catch { return {}; }
}
function setGameConfigValue(key: string, value: any) {
  const cfg = getGameConfig();
  cfg[key] = value;
  db.prepare('INSERT INTO game_config (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(JSON.stringify(cfg));
}
// Le mode "campagne héros seul" est-il activé ? (défaut : activé)
function heroCampaignEnabled(): boolean {
  const cfg = getGameConfig();
  return cfg.heroCampaignEnabled !== false;
}
// Onglets désactivés par l'admin (défaut : aucun). 'admin' jamais désactivable.
function getDisabledTabs(): string[] {
  const cfg = getGameConfig();
  return Array.isArray(cfg.disabledTabs) ? cfg.disabledTabs.filter((t: string) => t !== 'admin') : [];
}

function getInventory(playerId: string): any[] {
  return db.prepare('SELECT * FROM inventory WHERE player_id = ? ORDER BY equipped DESC, rowid DESC').all(playerId) as any[];
}

// Items de boss de campagne : un objet unique par chapitre, SANS statistiques.
// {ch}.png correspond au boss du chapitre {ch}. Nommé d'après le boss du chapitre.
const CAMPAIGN_BOSS_NAMES = [
  'Tréant Ancien', 'Ver des Sables', 'Géant du Givre', 'Hydre du Marais', 'Dragon de Magma',
  'Liche Souveraine', 'Kraken Abyssal', 'Griffon Tempête', 'Colosse Cristallin', 'Faucheur du Vide',
];
function campaignBossItemName(chapter: number): string {
  const n = CAMPAIGN_BOSS_NAMES[chapter - 1];
  return n ? `Trophée — ${n}` : `Trophée du chapitre ${chapter}`;
}
// Accorde l'item du boss au joueur — à CHAQUE victoire de boss de chapitre (100%).
function grantCampaignBossItem(playerId: string, chapter: number) {
  const source = `Boss Campagne — Chapitre ${chapter}`;
  const effects = JSON.stringify({
    __icon: `/campaign_items/${chapter}.png`,
    __source: source,
    __noStats: true,
  });
  db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, source) VALUES (?,?,?,?,?,?,?)')
    .run(genId(), playerId, 'item', campaignBossItemName(chapter), 'legendary', effects, source);
  return true;
}

function numericArmorEffects(raw: any): { attack: number; defense: number; hp: number; magic: number } {
  return {
    attack: Number(raw?.attack || 0),
    defense: Number(raw?.defense || 0),
    hp: Number(raw?.hp || 0),
    magic: Number(raw?.magic || 0),
  };
}

// ============================================================
// CRAFT D'ENCHANTEMENTS (débloqué HDV 10)
// Chaque stat exige des items de boss précis (par icône) + beaucoup d'or.
// Un craft produit 1 niveau d'enchantement (cumulable).
// Items consommés : boss Tour (/items/boss_item_NN.png) + boss Campagne (/campaign_items/N.png)
// ============================================================
type EnchantStat = 'attack' | 'defense' | 'hp' | 'magic' | 'speed' | 'crit' | 'crit_mult';
interface EnchantRecipe {
  stat: EnchantStat;
  label: string;
  gold: number;
  // items requis : icône -> quantité
  items: { icon: string; qty: number }[];
}
const ENCHANT_RECIPES: Record<EnchantStat, EnchantRecipe> = {
  attack:  { stat: 'attack',  label: 'Attaque',  gold: 10000, items: [{ icon: '/items/boss_item_01.png', qty: 2 }, { icon: '/campaign_items/2.png', qty: 4 }] },
  defense: { stat: 'defense', label: 'Défense',  gold: 10000, items: [{ icon: '/items/boss_item_03.png', qty: 2 }, { icon: '/campaign_items/1.png', qty: 4 }] },
  hp:      { stat: 'hp',      label: 'PV',       gold: 10000, items: [{ icon: '/items/boss_item_05.png', qty: 2 }, { icon: '/campaign_items/3.png', qty: 4 }] },
  magic:   { stat: 'magic',   label: 'Magie',    gold: 10000, items: [{ icon: '/items/boss_item_06.png', qty: 2 }, { icon: '/campaign_items/4.png', qty: 4 }] },
  speed:   { stat: 'speed',   label: 'Vitesse',  gold: 10000, items: [{ icon: '/items/boss_item_08.png', qty: 2 }, { icon: '/campaign_items/5.png', qty: 4 }] },
  crit:    { stat: 'crit',    label: 'Critique', gold: 10000, items: [{ icon: '/items/boss_item_10.png', qty: 2 }, { icon: '/campaign_items/6.png', qty: 4 }] },
  crit_mult: { stat: 'crit_mult', label: 'Multiplicateur de critique', gold: 25000, items: [{ icon: '/items/boss_item_10.png', qty: 3 }, { icon: '/campaign_items/6.png', qty: 6 }] },
};
// Valeur d'un niveau d'enchant ajoutée aux stats du héros (recettes Julia : +20 par craft).
const ENCHANT_PER_LEVEL: Record<EnchantStat, number> = { attack: 20, defense: 20, hp: 50, magic: 20, speed: 20, crit: 20, crit_mult: 0.1 };

// ============================================================
// CRITIQUE — passif du héros (chance) + multiplicateur (équipement).
// Chance : 5% de base, +0,857%/niv jusqu'à 35% au niveau max (35 niveaux).
// Multiplicateur : x1,1 de base, monte avec le total de 'crit_mult' des
// équipements (craft / suprême), plafonné à x2,5.
// ============================================================
const CRIT_MAX_LEVEL = 35;
// ---- BOSS DU JOUR ----
const DAILY_BOSS_RENOWN_MULT = 2;   // renommée x2
const DAILY_BOSS_RESOURCE_MULT = 3; // ressources x3
const DAILY_BOSS_COUNT = 40;
// Numéro de jour calé sur MINUIT LOCAL (fuseau du serveur), pas UTC.
// Tous les resets quotidiens (pity, clé, quête, boss du jour) utilisent ceci.
function localDayNum(at: number = Date.now()): number {
  const d = new Date(at);
  // Décale par l'offset local pour que le changement de jour soit à 00:00 local.
  return Math.floor((at - d.getTimezoneOffset() * 60000) / 86400000);
}
// Timestamp (ms) du prochain minuit local.
function nextLocalMidnight(at: number = Date.now()): number {
  const d = new Date(at);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}
// Index du boss du jour, déterministe à partir de la date (minuit local).
function dailyBossIndex(): number {
  const dayNum = localDayNum();
  // Hash simple pour répartir les boss sans motif évident.
  const h = (dayNum * 2654435761) >>> 0;
  return (h % DAILY_BOSS_COUNT) + 1;
}

// ---- PITY DE DROP DE BOSS ----
// Chaque combat de boss SANS objet signature dans la journée augmente la chance
// au combat suivant (+25% multiplicatif par échec). Le compteur se réinitialise
// quand l'objet tombe, et la liste repart à zéro chaque jour.
const BOSS_PITY_STEP = 0.25; // +25% par tentative ratée
function getBossPity(player: any): { day: number; counts: Record<string, number> } {
  let data: any = {};
  try { data = JSON.parse(player.boss_pity || '{}'); } catch { data = {}; }
  const today = localDayNum();
  if (data.day !== today) return { day: today, counts: {} };
  return { day: today, counts: data.counts || {} };
}
function bossPityMult(player: any, bossIndex: number): number {
  const { counts } = getBossPity(player);
  return 1 + (counts[String(bossIndex)] || 0) * BOSS_PITY_STEP;
}
// Met à jour le pity après un combat : +1 si pas de drop, reset si drop obtenu.
function updateBossPity(playerId: string, bossIndex: number, gotDrop: boolean) {
  const fresh = db.prepare('SELECT boss_pity FROM players WHERE id = ?').get(playerId) as any;
  const state = getBossPity(fresh);
  const key = String(bossIndex);
  if (gotDrop) state.counts[key] = 0;
  else state.counts[key] = (state.counts[key] || 0) + 1;
  db.prepare('UPDATE players SET boss_pity = ? WHERE id = ?').run(JSON.stringify(state), playerId);
}
function getDailyBoss() {
  const idx = dailyBossIndex();
  const endOfDay = nextLocalMidnight(); // prochain minuit local
  return {
    bossIndex: idx,
    bossName: BOSS_NAMES[idx - 1] || `Boss ${idx}`,
    renownMult: DAILY_BOSS_RENOWN_MULT,
    resourceMult: DAILY_BOSS_RESOURCE_MULT,
    guaranteedDrop: false, dropMult: 2,
    endsAt: Math.floor(endOfDay / 1000),
  };
}
const CRIT_BASE_CHANCE = 0.05;
const CRIT_MAX_CHANCE = 0.35;
const CRIT_BASE_MULT = 1.1;
const CRIT_MAX_MULT = 2.5;
function critChanceForLevel(level: number): number {
  const lv = Math.max(0, Math.min(CRIT_MAX_LEVEL, level || 0));
  return CRIT_BASE_CHANCE + (CRIT_MAX_CHANCE - CRIT_BASE_CHANCE) * (lv / CRIT_MAX_LEVEL);
}
// Bonus de SET : porter au moins 3 pièces équipées d'un même set (__set)
// débloque +5% de chance de critique. Cumulable par set distinct.
const SET_THRESHOLD = 3;
const SET_CRIT_BONUS = 0.05;
function setCritBonusForPlayer(playerId: string): number {
  const equipped = db.prepare('SELECT effects FROM inventory WHERE player_id = ? AND equipped = 1').all(playerId) as any[];
  const counts: Record<string, number> = {};
  for (const item of equipped) {
    try {
      const raw = JSON.parse(item.effects || '{}');
      const set = raw.__set;
      if (set) counts[set] = (counts[set] || 0) + 1;
    } catch { /* ignore */ }
  }
  let bonus = 0;
  for (const set of Object.keys(counts)) {
    if (counts[set] >= SET_THRESHOLD) bonus += SET_CRIT_BONUS;
  }
  return bonus;
}
// Chance de critique totale = passif (niveau) + bonus de sets, plafonné au max.
function totalCritChance(playerId: string, critLevel: number): number {
  return Math.min(CRIT_MAX_CHANCE, critChanceForLevel(critLevel) + setCritBonusForPlayer(playerId));
}

// ============================================================
// FORGE — atelier de reroll / transfert de statistiques.
// Niveau 1→5, améliorations très chères (surtout de l'or). Plus le niveau
// est élevé, meilleur est le reroll (multiplicateur de qualité).
// ============================================================
const FORGE_MAX_LEVEL = 5;
// Coût d'amélioration de la forge (du niveau actuel vers le suivant). Très cher.
function forgeUpgradeCost(level: number): Record<string, number> {
  const tier = level; // 1→2 coûte tier 1, etc.
  const gold = 250000 * Math.pow(3, tier - 1);      // 250k, 750k, 2.25M, 6.75M
  const iron = 40000 * Math.pow(2.4, tier - 1);
  const stone = 40000 * Math.pow(2.4, tier - 1);
  return {
    gold: Math.floor(gold), iron: Math.floor(iron), stone: Math.floor(stone),
    wood: Math.floor(iron * 0.5), food: 0, magic_energy: Math.floor(iron * 0.3),
  };
}
// Multiplicateur de qualité du reroll selon le niveau de forge (1.0 → 2.0).
function forgeQualityMult(forgeLevel: number): number {
  const lv = Math.max(1, Math.min(FORGE_MAX_LEVEL, forgeLevel || 1));
  return 1 + (lv - 1) * 0.25; // niv1=1.0, niv5=2.0
}
function getPlayerForge(playerId: string): any {
  const v = getVillageByPlayer(playerId);
  if (!v) return null;
  return db.prepare("SELECT * FROM buildings WHERE village_id = ? AND type = 'forge'").get(v.id) as any;
}
// Statistiques numériques rerollables d'un équipement (hors méta __ et crit_mult).
const FORGE_STAT_KEYS = ['attack', 'defense', 'hp', 'magic', 'speed', 'crit'];
function rerollItemEffects(effects: Record<string, any>, forgeLevel: number): Record<string, any> {
  const q = forgeQualityMult(forgeLevel);
  const out: Record<string, any> = { ...effects };
  for (const k of FORGE_STAT_KEYS) {
    if (typeof effects[k] === 'number' && effects[k] !== 0) {
      const base = effects[k] as number;
      // Reroll entre 60% et (110% × qualité) de la valeur d'origine.
      const factor = 0.6 + Math.random() * (0.5 * q + 0.0);
      out[k] = Math.max(1, Math.floor(base * factor * q));
    }
  }
  return out;
}
// Multiplicateur de critique = base + somme des 'crit_mult' des équipements équipés.
function critMultForPlayer(playerId: string): number {
  const equipped = db.prepare('SELECT effects FROM inventory WHERE player_id = ? AND equipped = 1').all(playerId) as any[];
  let extra = 0;
  for (const item of equipped) {
    try {
      const raw = JSON.parse(item.effects || '{}');
      // Drops suprême / GOD : crit_mult stocké directement comme un nombre additif.
      extra += Number(raw.crit_mult || 0);
      // Craft (enchantement) : compteur de niveaux × valeur par niveau.
      const ench = raw.__enchants || {};
      extra += Number(ench.crit_mult || 0) * ENCHANT_PER_LEVEL.crit_mult;
    } catch { /* ignore */ }
  }
  return Math.min(CRIT_MAX_MULT, CRIT_BASE_MULT + extra);
}

// ============================================================
// POTIONS — buffs temporaires craftables dès le début.
// Coût : 10 000 or + quelques items de boss. Durée limitée.
// ============================================================
type PotionId = 'xp_boost' | 'loot_boost' | 'production_boost' | 'renown_boost' | 'magic_find' | 'boss_drop_boost';
interface PotionRecipe {
  id: PotionId;
  label: string;
  icon: string;
  desc: string;
  gold: number;
  durationSec: number;
  multiplier: number;
  items: { icon: string; qty: number }[];
}
const POTION_RECIPES: Record<PotionId, PotionRecipe> = {
  xp_boost:         { id: 'xp_boost',         label: 'Potion de Sagesse',     icon: '📘', desc: 'XP du héros x1,5 pendant 30 min.',                gold: 10000, durationSec: 1800, multiplier: 1.5, items: [{ icon: '/items/boss_item_02.png', qty: 1 }] },
  loot_boost:       { id: 'loot_boost',       label: 'Potion de Pillage',     icon: '💰', desc: 'Ressources gagnées en combat x2 pendant 30 min.', gold: 10000, durationSec: 1800, multiplier: 2,   items: [{ icon: '/items/boss_item_04.png', qty: 1 }] },
  production_boost: { id: 'production_boost', label: 'Potion de Prospérité',  icon: '🏭', desc: 'Production du village x2 pendant 15 min.',         gold: 10000, durationSec: 900,  multiplier: 2,   items: [{ icon: '/items/boss_item_05.png', qty: 1 }] },
  renown_boost:     { id: 'renown_boost',     label: 'Potion de Gloire',      icon: '🏆', desc: 'Renommée gagnée en combat x1,5 pendant 30 min.',  gold: 10000, durationSec: 1800, multiplier: 1.5, items: [{ icon: '/items/boss_item_07.png', qty: 1 }] },
  magic_find:       { id: 'magic_find',       label: "Potion de l'Aubaine",   icon: '🍀', desc: "Double la chance d'obtenir un équipement (30 min).", gold: 10000, durationSec: 1800, multiplier: 2,   items: [{ icon: '/items/boss_item_09.png', qty: 1 }] },
  boss_drop_boost:  { id: 'boss_drop_boost',  label: 'Potion du Chasseur',    icon: '🎯', desc: "Double la chance de drop de l'objet signature des boss (30 min).", gold: 15000, durationSec: 1800, multiplier: 2, items: [{ icon: '/items/boss_item_10.png', qty: 1 }, { icon: '/campaign_items/6.png', qty: 2 }] },
};

// Lit les buffs encore actifs d'un joueur (nettoie les expirés).
function getActiveBuffs(playerId: string): Record<string, number> {
  const row = db.prepare('SELECT active_buffs FROM players WHERE id = ?').get(playerId) as any;
  let buffs: Record<string, number> = {};
  try { buffs = JSON.parse(row?.active_buffs || '{}'); } catch { buffs = {}; }
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const k of Object.keys(buffs)) {
    if (!buffs[k] || buffs[k] <= now) { delete buffs[k]; changed = true; }
  }
  if (changed) db.prepare('UPDATE players SET active_buffs = ? WHERE id = ?').run(JSON.stringify(buffs), playerId);
  return buffs;
}
// Multiplicateur actif pour un buff donné (1 si inactif).
function buffMultiplier(playerId: string, id: PotionId): number {
  const buffs = getActiveBuffs(playerId);
  const now = Math.floor(Date.now() / 1000);
  if (buffs[id] && buffs[id] > now) return POTION_RECIPES[id].multiplier;
  return 1;
}

function itemIconOf(item: any): string {
  try { const e = JSON.parse(item.effects || '{}'); return e.__icon || ''; } catch { return ''; }
}
// Compte les items possédés par icône.
function countItemsByIcon(playerId: string): Record<string, number> {
  const inv = db.prepare('SELECT effects FROM inventory WHERE player_id = ?').all(playerId) as any[];
  const out: Record<string, number> = {};
  for (const it of inv) { const ic = itemIconOf(it); if (ic) out[ic] = (out[ic] || 0) + 1; }
  return out;
}
// Consomme qty items d'une icône donnée (supprime les lignes). Renvoie false si insuffisant.
function consumeItemsByIcon(playerId: string, icon: string, qty: number): boolean {
  const rows = db.prepare('SELECT id, effects FROM inventory WHERE player_id = ?').all(playerId) as any[];
  const matching = rows.filter(r => itemIconOf(r) === icon).slice(0, qty);
  if (matching.length < qty) return false;
  const del = db.prepare('DELETE FROM inventory WHERE id = ?');
  for (const m of matching) del.run(m.id);
  return true;
}

function applyEquippedHeroStats(playerId: string) {
  const hero = getHero(playerId);
  if (!hero) return;
  const base = heroStatsForLevel(hero.level || 1);
  const equipped = db.prepare('SELECT * FROM inventory WHERE player_id = ? AND equipped = 1').all(playerId) as any[];
  const bonus = { attack: 0, defense: 0, hp: 0, magic: 0 };
  for (const item of equipped) {
    const raw = JSON.parse(item.effects || '{}');
    const effects = numericArmorEffects(raw);
    bonus.attack += effects.attack;
    bonus.defense += effects.defense;
    bonus.hp += effects.hp;
    bonus.magic += effects.magic;
    // Enchantements appliqués sur cet équipement (cumulables, empilables).
    const ench = raw.__enchants || {};
    bonus.attack += Number(ench.attack || 0) * ENCHANT_PER_LEVEL.attack;
    bonus.defense += Number(ench.defense || 0) * ENCHANT_PER_LEVEL.defense;
    bonus.hp += Number(ench.hp || 0) * ENCHANT_PER_LEVEL.hp;
    bonus.magic += Number(ench.magic || 0) * ENCHANT_PER_LEVEL.magic;
    // speed / crit : le héros ne possède pas ces stats de base, ignorées ici.
  }
  db.prepare('UPDATE heroes SET attack = ?, defense = ?, hp = ?, magic = ? WHERE player_id = ?')
    .run(base.attack + bonus.attack, base.defense + bonus.defense, base.hp + bonus.hp, base.magic + bonus.magic, playerId);
}

function updateResources(villageId: string, stone: number, iron: number, gold: number, food: number, wood: number, magic: number) {
  db.prepare('UPDATE resources SET stone = ?, iron = ?, gold = ?, food = ?, wood = ?, magic_energy = ? WHERE village_id = ?')
    .run(stone, iron, gold, food, wood, magic, villageId);
}

// Tick resources based on production
function tickResources(villageId: string): any {
  const village = getVillageByPlayer((getVillageByPlayer as any).call ? '' : '');
  const v = db.prepare('SELECT * FROM villages WHERE id = ?').get(villageId) as any;
  if (!v) return null;

  const resources = getResources(villageId);
  if (!resources) return null;
  // Compte ADMIN : ressources toujours "infinies" (jamais drainées par les dépenses de test).
  {
    const owner = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(v.player_id) as any;
    if (owner && owner.is_admin) {
      const INF = 1000000000;
      for (const r of RESOURCES) (resources as any)[r] = INF;
      return resources;
    }
  }
  const buildings = getBuildings(villageId);
  const tier = v.tier;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(v.player_id) as any;
  const prestigeBonus = player ? getPrestigeBonuses(player.prestige_count) : getPrestigeBonuses(0);
  // Potion de Prospérité : production du village x2 si active.
  const prodBuff = player ? buffMultiplier(player.id, 'production_boost') : 1;

  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - resources.last_update);
  if (elapsed < 1) return resources;

  const totalProduction: Record<string, number> = {};
  const totalConsumption: Record<string, number> = {};
  for (const res of RESOURCES) {
    totalProduction[res] = 0;
    totalConsumption[res] = 0;
  }

  for (const building of buildings) {
    const prod = calculateProduction(building.type as BuildingType, building.level, building.workers_assigned, tier);
    const cons = calculateConsumption(building.type as BuildingType, building.level, building.workers_assigned);
    for (const res of RESOURCES) {
      totalProduction[res] += prod[res] * prestigeBonus.productionMultiplier * prodBuff;
      totalConsumption[res] += cons[res];
    }
  }

  const troops = getTroops(villageId);
  // Les troupes ne consomment plus de nourriture.
  const totalFoodUpkeep = 0;
  totalConsumption.food += totalFoodUpkeep;

  const townHall = buildings.find((b: any) => b.type === 'town_hall');

  // ---- FORGE : atelier de reroll/transfert (n'emploie plus d'ouvriers et
  // ne fabrique plus automatiquement d'équipement). Aucune production passive.

  const caps = getResourceCaps(tier, townHall ? townHall.level : (v.town_hall_level || 1));
  const updates: Record<string, number> = {};
  for (const res of RESOURCES) {
    const net = (totalProduction[res] - totalConsumption[res]) * elapsed;
    const newVal = Math.min(caps[res], Math.max(0, resources[res] + net));
    updates[res] = Math.floor(newVal * 100) / 100;
  }

  db.prepare(`
    UPDATE resources SET 
      stone = ?, iron = ?, gold = ?, food = ?, wood = ?, magic_energy = ?,
      max_stone = ?, max_iron = ?, max_gold = ?, max_food = ?, max_wood = ?, max_magic_energy = ?,
      last_update = ?
    WHERE village_id = ?
  `).run(
    updates.stone, updates.iron, updates.gold, updates.food, updates.wood, updates.magic_energy,
    caps.stone, caps.iron, caps.gold, caps.food, caps.wood, caps.magic_energy,
    now, villageId
  );

  // ---- BIBLIOTHÈQUE : XP passive pour le héros ----
  // 0.5 XP par ouvrier toutes les 5 min (300 s), proratisé sur le temps écoulé.
  const libWorkers = buildings
    .filter((b: any) => b.type === 'library')
    .reduce((sum: number, b: any) => sum + (b.workers_assigned || 0), 0);
  if (libWorkers > 0 && v.player_id) {
    const xpGain = libWorkers * 0.5 * (elapsed / 300);
    if (xpGain > 0) creditHeroXp(v.player_id, xpGain);
  }

  return {
    ...resources, ...updates,
    max_stone: caps.stone, max_iron: caps.iron, max_gold: caps.gold,
    max_food: caps.food, max_wood: caps.wood, max_magic_energy: caps.magic_energy,
    last_update: now,
  };
}

// Crédite de l'XP au héros (gère le passage de niveau) — utilisé par la bibliothèque.
function creditHeroXp(playerId: string, amount: number) {
  const hero = db.prepare('SELECT * FROM heroes WHERE player_id = ?').get(playerId) as any;
  if (!hero) return;
  let newXp = (hero.xp || 0) + amount;
  let newLevel = hero.level;
  let skillPointsGained = 0;
  while (newXp >= heroXpForLevel(newLevel)) {
    newXp -= heroXpForLevel(newLevel);
    newLevel++;
    skillPointsGained++;
  }
  if (newLevel !== hero.level) {
    const s = heroStatsForLevel(newLevel);
    db.prepare('UPDATE heroes SET level = ?, xp = ?, skill_points = skill_points + ?, attack = ?, defense = ?, hp = ?, magic = ? WHERE player_id = ?')
      .run(newLevel, newXp, skillPointsGained, s.attack, s.defense, s.hp, s.magic, playerId);
    applyEquippedHeroStats(playerId);
  } else {
    db.prepare('UPDATE heroes SET xp = ? WHERE player_id = ?').run(newXp, playerId);
  }
}

function getFullVillageState(playerId: string) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as any;
  if (!player) return null;

  const village = getVillageByPlayer(playerId);
  if (!village) return null;

  const resources = tickResources(village.id);

  // Compte ADMIN : HDV 30, tier max, ressources "infinies" (pour tester tous les modes).
  if (player.is_admin) {
    const INF = 1000000000; // 1 milliard de chaque ressource
    for (const r of RESOURCES) resources[r] = INF;
    village.town_hall_level = 30;
    village.tier = getTierForLevel ? getTierForLevel(30) : (village.tier || 5);
  }
  const tierConfigForVillage = getTierConfig(village.tier);
  const buildingsBeforeFix = getBuildings(village.id);
  const mines = buildingsBeforeFix
    .filter((b: any) => b.type === 'mine')
    .sort((a: any, b: any) => (b.level - a.level) || (b.workers_assigned - a.workers_assigned));
  const maxMines = tierConfigForVillage.maxBuildings.mine || 0;
  if (mines.length > maxMines) {
    for (const mine of mines.slice(maxMines)) {
      db.prepare('DELETE FROM buildings WHERE id = ?').run(mine.id);
    }
  }
  const hasLumberjack = buildingsBeforeFix.some((b: any) => b.type === 'lumberjack');
  const maxLumberjacks = tierConfigForVillage.maxBuildings.lumberjack || 0;
  if (!hasLumberjack && maxLumberjacks > 0) {
    db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, ?, ?)')
      .run(genId(), village.id, 'lumberjack', 2, getMaxWorkers('lumberjack' as BuildingType, 1));
  }

  // La caserne a été retirée du jeu : on supprime définitivement tout bâtiment
  // caserne restant. Ses ouvriers reviennent automatiquement dans la réserve
  // (workersUsed baisse), libres d'être réassignés par le joueur.
  db.prepare(`DELETE FROM buildings WHERE village_id = ? AND type = 'barracks'`).run(village.id);

  const buildings = getBuildings(village.id);
  // Mise à jour douce : plafonne tous les bâtiments à 5 ouvriers max.
  for (const b of buildings) {
    if ((b.max_workers || 0) !== 5 || (b.workers_assigned || 0) > 5) {
      const wa = Math.min(5, b.workers_assigned || 0);
      db.prepare('UPDATE buildings SET max_workers = 5, workers_assigned = ? WHERE id = ?').run(wa, b.id);
      b.max_workers = 5; b.workers_assigned = wa;
    }
  }
  const workersUsed = buildings.reduce((sum: number, b: any) => sum + (b.workers_assigned || 0), 0);
  const workerPool = village.worker_pool ?? 10;
  const workerPoolCap = getWorkerPoolCap(village.town_hall_level || 1);
  const troops = getTroops(village.id);
  const hero = getHero(playerId);
  const inventory = getInventory(playerId);
  const campaignProgress = db.prepare('SELECT * FROM campaign_progress WHERE player_id = ?').get(playerId) as any;
  const towerProgress = db.prepare('SELECT * FROM tower_progress WHERE player_id = ?').get(playerId) as any;
  const bossProgress = db.prepare('SELECT * FROM boss_progress WHERE player_id = ?').get(playerId) as any;
  const research = db.prepare('SELECT * FROM research WHERE village_id = ?').all(village.id) as any[];
  const prestigeBonus = getPrestigeBonuses(player.prestige_count);

  return {
    player: { id: player.id, username: player.username, renown: player.renown, prestige_count: player.prestige_count, prestige_bonuses: player.prestige_bonuses, enchants: JSON.parse(player.enchants || '{}'), isAdmin: !!player.is_admin, dungeon_keys: player.dungeon_keys || 0 },
    activeBuffs: getActiveBuffs(playerId),
    disabledTabs: getDisabledTabs(),
    activeBuffMults: { production_boost: buffMultiplier(playerId, 'production_boost'), loot_boost: buffMultiplier(playerId, 'loot_boost'), xp_boost: buffMultiplier(playerId, 'xp_boost'), renown_boost: buffMultiplier(playerId, 'renown_boost'), magic_find: buffMultiplier(playerId, 'magic_find'), boss_drop_boost: buffMultiplier(playerId, 'boss_drop_boost') },
    village,
    resources,
    buildings,
    troops,
    hero: hero ? { ...hero, crit_level: hero.crit_level || 0, crit_chance: totalCritChance(playerId, hero.crit_level || 0), crit_set_bonus: setCritBonusForPlayer(playerId), crit_mult: critMultForPlayer(playerId), crit_max_level: CRIT_MAX_LEVEL, crit_max_chance: CRIT_MAX_CHANCE, crit_max_mult: CRIT_MAX_MULT } : hero,
    inventory,
    campaign: campaignProgress || { chapter: 1, episode: 1 },
    tower: towerProgress || { current_floor: 0, best_floor: 0 },
    towerMultipliers: getDifficulty().tower.allowedMultipliers,
    boss: bossProgress || { highest_boss: 0 },
    research,
    prestigeBonus,
    workers: {
      pool: workerPool,
      used: workersUsed,
      available: workerPool - workersUsed,
      cap: workerPoolCap,
      nextCost: getWorkerPurchaseCost(workerPool),
    },
    tierConfig: getTierConfig(village.tier)
  };
}

// =============================================
// SESSIONS (connexion auto 1h)
// =============================================

const SESSION_TTL = 60 * 60; // 1 heure en secondes

function createSession(playerId: string): string {
  const token = genId() + genId();
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
  db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
  db.prepare('INSERT INTO sessions (token, player_id, expires_at) VALUES (?, ?, ?)').run(token, playerId, expires);
  return token;
}

function playerFromToken(token: string): any | null {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const sess = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any;
  if (!sess) return null;
  if (sess.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT * FROM players WHERE id = ?').get(sess.player_id) as any;
}

// =============================================
// SOCKET.IO HANDLERS
// =============================================

io.on('connection', (socket) => {
  console.log(`[Game] Connection: ${socket.id}`);

  // ---- REGISTER (create account) ----
  socket.on('register', (data: { username: string; password: string }, callback) => {
    try {
      const { username, password } = data;

      if (!username || username.trim().length < 2) {
        callback({ success: false, error: 'Le nom doit contenir au moins 2 caractères' });
        return;
      }
      if (!password || password.length < 3) {
        callback({ success: false, error: 'Le mot de passe doit contenir au moins 3 caractères' });
        return;
      }

      const existing = db.prepare('SELECT id FROM players WHERE username = ?').get(username.trim()) as any;
      if (existing) {
        callback({ success: false, error: 'Ce nom est déjà pris !' });
        return;
      }
      if (username.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
        callback({ success: false, error: 'Ce nom est réservé.' });
        return;
      }

      const playerId = genId();
      const villageId = genId();

      db.prepare('INSERT INTO players (id, username, password_hash, renown, prestige_count) VALUES (?, ?, ?, 0, 0)')
        .run(playerId, username.trim(), password);

      db.prepare('INSERT INTO villages (id, player_id, name, tier, town_hall_level) VALUES (?, ?, ?, 1, 1)')
        .run(villageId, playerId, `Village de ${username.trim()}`);

      const resId = genId();
      db.prepare('INSERT INTO resources (id, village_id, stone, iron, gold, food, wood, magic_energy) VALUES (?, ?, 500, 300, 200, 400, 600, 100)')
        .run(resId, villageId);

      const buildingTypes: BuildingType[] = ['town_hall', 'mine', 'lumberjack', 'farm', 'farm'];
      for (const type of buildingTypes) {
        const maxW = getMaxWorkers(type, 1);
        db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, ?, ?)')
          .run(genId(), villageId, type, type === 'town_hall' ? 0 : 2, maxW);
      }

      db.prepare('INSERT INTO troops (id, village_id, type, count, level) VALUES (?, ?, ?, 5, 1)')
        .run(genId(), villageId, 'soldier');

      db.prepare('INSERT INTO heroes (id, player_id, name, level, xp, skill_points, skills, attack, defense, hp, magic) VALUES (?, ?, ?, 1, 0, 1, ?, 10, 10, 100, 5)')
        .run(genId(), playerId, 'Héros', '{}');

      db.prepare('INSERT INTO campaign_progress (id, player_id, chapter, episode) VALUES (?, ?, 1, 1)')
        .run(genId(), playerId);

      db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor) VALUES (?, ?, 0, 0)')
        .run(genId(), playerId);

      // Auto-login after registration
      db.prepare('UPDATE players SET online = 1, socket_id = ?, last_login = strftime("%s","now") WHERE id = ?')
        .run(socket.id, playerId);

      const state = getFullVillageState(playerId);
      const token = createSession(playerId);
      callback({ success: true, state, token });
      console.log(`[Game] ${username.trim()} registered and logged in`);
    } catch (err: any) {
      callback({ success: false, error: err.message });
    }
  });

  // ---- LOGIN (existing account) ----
  socket.on('login', (data: { username: string; password: string }, callback) => {
    try {
      const { username, password } = data;

      if (!username || !password) {
        callback({ success: false, error: 'Veuillez remplir tous les champs' });
        return;
      }

      const player = db.prepare('SELECT * FROM players WHERE username = ?').get(username.trim()) as any;
      if (!player) {
        callback({ success: false, error: 'Aucun compte avec ce nom' });
        return;
      }

      if (player.password_hash !== password) {
        callback({ success: false, error: 'Mot de passe incorrect' });
        return;
      }

      db.prepare('UPDATE players SET online = 1, socket_id = ?, last_login = strftime("%s","now") WHERE id = ?')
        .run(socket.id, player.id);

      const state = getFullVillageState(player.id);
      const token = createSession(player.id);
      callback({ success: true, state, token });
    } catch (err: any) {
      callback({ success: false, error: err.message });
    }
  });

  // ---- RESUME SESSION (connexion auto via token, valide 1h) ----
  socket.on('resume_session', (data: { token: string }, callback) => {
    try {
      const player = playerFromToken(data?.token);
      if (!player) { callback({ success: false, error: 'Session expirée' }); return; }

      db.prepare('UPDATE players SET online = 1, socket_id = ?, last_login = strftime("%s","now") WHERE id = ?')
        .run(socket.id, player.id);

      const state = getFullVillageState(player.id);
      const token = createSession(player.id); // prolonge encore 1h
      callback({ success: true, state, token });

      const friends = db.prepare('SELECT friend_id FROM friends WHERE player_id = ? AND status = ?').all(player.id, 'accepted') as any[];
      for (const f of friends) {
        const friend = db.prepare('SELECT socket_id FROM players WHERE id = ? AND online = 1').get(f.friend_id) as any;
        if (friend?.socket_id) io.to(friend.socket_id).emit('friend_online', { playerId: player.id, username: player.username });
      }
      console.log(`[Game] ${player.username} session resumed`);
    } catch (err: any) {
      callback({ success: false, error: err.message });
    }
  });

  // ============================================================
  // ADMINISTRATION (réservé au compte Admin)
  // ============================================================
  function requireAdmin(cb: any): any | null {
    const p = getPlayerBySocket(socket.id);
    if (!p) { cb({ success: false, error: 'Non authentifié' }); return null; }
    if (!p.is_admin) { cb({ success: false, error: 'Accès refusé' }); return null; }
    return p;
  }

  // L'admin ne joue pas : bloque les actions de jeu. Renvoie true si bloqué.
  function blockIfAdmin(_cb: any): boolean {
    // L'admin peut tout tester : aucune action n'est bloquée.
    return false;
  }

  // Liste de tous les joueurs avec leurs données clés.
  socket.on('admin_list_players', (_data, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const rows = db.prepare(`
        SELECT p.id, p.username, p.renown, p.prestige_count, p.online, p.is_admin,
               v.town_hall_level, v.tier, h.level AS hero_level,
               t.best_floor AS tower_best_floor
        FROM players p
        LEFT JOIN villages v ON v.player_id = p.id
        LEFT JOIN heroes h ON h.player_id = p.id
        LEFT JOIN tower_progress t ON t.player_id = p.id
        ORDER BY p.renown DESC
      `).all();
      callback({ success: true, players: rows });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Modifier les données d'un joueur (renommée, prestige, niveau HDV).
  socket.on('admin_update_player', (data: { playerId: string; renown?: number; prestige_count?: number; town_hall_level?: number; tower_best_floor?: number }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const target = db.prepare('SELECT * FROM players WHERE id = ?').get(data.playerId) as any;
      if (!target) { callback({ success: false, error: 'Joueur introuvable' }); return; }

      if (typeof data.renown === 'number' && isFinite(data.renown)) {
        db.prepare('UPDATE players SET renown = ? WHERE id = ?').run(Math.max(0, Math.floor(data.renown)), data.playerId);
      }
      if (typeof data.prestige_count === 'number' && isFinite(data.prestige_count)) {
        db.prepare('UPDATE players SET prestige_count = ? WHERE id = ?').run(Math.max(0, Math.floor(data.prestige_count)), data.playerId);
      }
      if (typeof data.town_hall_level === 'number' && isFinite(data.town_hall_level)) {
        const thl = Math.max(1, Math.min(99, Math.floor(data.town_hall_level)));
        db.prepare('UPDATE villages SET town_hall_level = ? WHERE player_id = ?').run(thl, data.playerId);
        // Met aussi à jour le bâtiment HDV s'il existe.
        const v = db.prepare('SELECT id FROM villages WHERE player_id = ?').get(data.playerId) as any;
        if (v) db.prepare('UPDATE buildings SET level = ? WHERE village_id = ? AND type = ?').run(thl, v.id, 'town_hall');
      }
      // Record d'étage de la tour (best_floor) : modifiable depuis l'admin.
      if (typeof data.tower_best_floor === 'number' && isFinite(data.tower_best_floor)) {
        const bf = Math.max(0, Math.floor(data.tower_best_floor));
        const tp = db.prepare('SELECT id FROM tower_progress WHERE player_id = ?').get(data.playerId) as any;
        if (tp) db.prepare('UPDATE tower_progress SET best_floor = ? WHERE player_id = ?').run(bf, data.playerId);
        else db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor) VALUES (?, ?, 0, ?)').run(genId(), data.playerId, bf);
      }

      const updated = db.prepare('SELECT id, username, renown, prestige_count FROM players WHERE id = ?').get(data.playerId) as any;
      const v2 = db.prepare('SELECT town_hall_level FROM villages WHERE player_id = ?').get(data.playerId) as any;
      const tp2 = db.prepare('SELECT best_floor FROM tower_progress WHERE player_id = ?').get(data.playerId) as any;
      // Si le joueur ciblé est en ligne, on lui pousse son nouvel état.
      if (target.socket_id) { try { io.to(target.socket_id).emit('state_update', getFullVillageState(data.playerId)); } catch {} }
      callback({ success: true, player: { ...updated, town_hall_level: v2?.town_hall_level, tower_best_floor: tp2?.best_floor ?? 0 } });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Créer un nouveau compte joueur depuis l'admin.
  socket.on('admin_create_user', (data: { username: string; password: string }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const username = (data?.username || '').trim();
      const password = data?.password || '';
      if (username.length < 2) { callback({ success: false, error: 'Nom trop court (2 caractères min)' }); return; }
      if (password.length < 3) { callback({ success: false, error: 'Mot de passe trop court (3 caractères min)' }); return; }
      if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) { callback({ success: false, error: 'Nom réservé' }); return; }
      const exists = db.prepare('SELECT id FROM players WHERE username = ?').get(username) as any;
      if (exists) { callback({ success: false, error: 'Ce nom est déjà pris' }); return; }
      createPlayerWorld(username, password);
      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Changer le mot de passe d'un joueur.
  socket.on('admin_set_password', (data: { playerId: string; password: string }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const password = data?.password || '';
      if (password.length < 3) { callback({ success: false, error: 'Mot de passe trop court (3 caractères min)' }); return; }
      const target = db.prepare('SELECT id FROM players WHERE id = ?').get(data.playerId) as any;
      if (!target) { callback({ success: false, error: 'Joueur introuvable' }); return; }
      db.prepare('UPDATE players SET password_hash = ? WHERE id = ?').run(password, data.playerId);
      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Alerte admin : popup central + message en gras coloré dans le tchat, pour tous.
  socket.on('admin_send_alert', (data: { message: string }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const message = (data?.message || '').trim();
      if (!message) { callback({ success: false, error: 'Message vide' }); return; }
      io.emit('admin_alert', { message, ts: Date.now() });
      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Difficulté : lecture / modification / réinitialisation.
  socket.on('admin_get_difficulty', (_data, callback) => {
    try { if (!requireAdmin(callback)) return; callback({ success: true, difficulty: getDifficulty(), defaults: DEFAULT_DIFFICULTY }); }
    catch (err: any) { callback({ success: false, error: err.message }); }
  });
  socket.on('admin_set_difficulty', (data: { difficulty: any }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const next = setDifficulty(data?.difficulty || {});
      saveDifficultyConfig(next);
      callback({ success: true, difficulty: next });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });
  socket.on('admin_reset_difficulty', (_data, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const next = resetDifficulty();
      saveDifficultyConfig(next);
      callback({ success: true, difficulty: next });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Config globale : activer/désactiver le mode "campagne héros seul".
  socket.on('admin_get_config', (_data, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      callback({ success: true, heroCampaignEnabled: heroCampaignEnabled(), disabledTabs: getDisabledTabs() });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });
  socket.on('admin_set_hero_campaign', (data: { enabled: boolean }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      setGameConfigValue('heroCampaignEnabled', !!data.enabled);
      callback({ success: true, heroCampaignEnabled: !!data.enabled });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });
  // Activer/désactiver des onglets pour tous les joueurs.
  socket.on('admin_set_tabs', (data: { disabledTabs: string[] }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const list = Array.isArray(data?.disabledTabs) ? data.disabledTabs.filter((t) => typeof t === 'string' && t !== 'admin') : [];
      setGameConfigValue('disabledTabs', list);
      // Pousse le nouvel état à tous les joueurs connectés.
      try {
        const online = db.prepare("SELECT id, socket_id FROM players WHERE socket_id IS NOT NULL AND socket_id != ''").all() as any[];
        for (const p of online) { if (p.socket_id) io.to(p.socket_id).emit('state_update', getFullVillageState(p.id)); }
      } catch {}
      callback({ success: true, disabledTabs: list });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Sauvegardes : liste / création / restauration.
  socket.on('admin_list_backups', (_data, callback) => {
    try { if (!requireAdmin(callback)) return; callback({ success: true, backups: listBackups() }); }
    catch (err: any) { callback({ success: false, error: err.message }); }
  });
  socket.on('admin_create_backup', (_data, callback) => {
    try { if (!requireAdmin(callback)) return; const b = createBackup(); callback({ success: true, created: b.name, backups: listBackups() }); }
    catch (err: any) { callback({ success: false, error: err.message }); }
  });
  socket.on('admin_restore_backup', (data: { name: string }, callback) => {
    try {
      if (!requireAdmin(callback)) return;
      const ok = restoreBackup(data?.name);
      if (!ok) { callback({ success: false, error: 'Restauration impossible' }); return; }
      callback({ success: true, backups: listBackups() });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- AUTH (legacy, kept for compatibility - now acts as login only) ----
  socket.on('auth', (data: { username: string; password: string }, callback) => {
    try {
      const { username, password } = data;
      let player = db.prepare('SELECT * FROM players WHERE username = ?').get(username) as any;

      if (!player) {
        // Auto-register for backward compat
        const playerId = genId();
        const villageId = genId();

        db.prepare('INSERT INTO players (id, username, password_hash, renown, prestige_count) VALUES (?, ?, ?, 0, 0)')
          .run(playerId, username, password);

        db.prepare('INSERT INTO villages (id, player_id, name, tier, town_hall_level) VALUES (?, ?, ?, 1, 1)')
          .run(villageId, playerId, `Village de ${username}`);

        const resId = genId();
        db.prepare('INSERT INTO resources (id, village_id, stone, iron, gold, food, wood, magic_energy) VALUES (?, ?, 500, 300, 200, 400, 600, 100)')
          .run(resId, villageId);

        const buildingTypes: BuildingType[] = ['town_hall', 'mine', 'lumberjack', 'farm', 'farm'];
        for (const type of buildingTypes) {
          const maxW = getMaxWorkers(type, 1);
          db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, ?, ?)')
            .run(genId(), villageId, type, type === 'town_hall' ? 0 : 2, maxW);
        }

        db.prepare('INSERT INTO troops (id, village_id, type, count, level) VALUES (?, ?, ?, 5, 1)')
          .run(genId(), villageId, 'soldier');

        db.prepare('INSERT INTO heroes (id, player_id, name, level, xp, skill_points, skills, attack, defense, hp, magic) VALUES (?, ?, ?, 1, 0, 1, ?, 10, 10, 100, 5)')
          .run(genId(), playerId, 'Héros', '{}');

        db.prepare('INSERT INTO campaign_progress (id, player_id, chapter, episode) VALUES (?, ?, 1, 1)')
          .run(genId(), playerId);

        db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor) VALUES (?, ?, 0, 0)')
          .run(genId(), playerId);

        player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as any;
      } else {
        if (player.password_hash !== password) {
          callback({ success: false, error: 'Mot de passe incorrect' });
          return;
        }
      }

      db.prepare('UPDATE players SET online = 1, socket_id = ?, last_login = strftime("%s","now") WHERE id = ?')
        .run(socket.id, player.id);

      const state = getFullVillageState(player.id);
      callback({ success: true, state });

      // Notify friends
      const friends = db.prepare('SELECT friend_id FROM friends WHERE player_id = ? AND status = ?').all(player.id, 'accepted') as any[];
      for (const f of friends) {
        const friend = db.prepare('SELECT socket_id FROM players WHERE id = ? AND online = 1').get(f.friend_id) as any;
        if (friend?.socket_id) {
          io.to(friend.socket_id).emit('friend_online', { playerId: player.id, username: player.username });
        }
      }

      console.log(`[Game] ${username} connected`);
    } catch (err: any) {
      callback({ success: false, error: err.message });
    }
  });

  // ---- GET STATE ----
  socket.on('get_state', (_data, callback) => {
    const player = getPlayerBySocket(socket.id);
    if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
    callback({ success: true, state: getFullVillageState(player.id) });
  });

  // ---- UPGRADE BUILDING ----
  socket.on('upgrade_building', (data: { buildingId: string }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(data.buildingId) as any;
      if (!building) { callback({ success: false, error: 'Bâtiment introuvable' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village || building.village_id !== village.id) { callback({ success: false, error: 'Pas votre bâtiment' }); return; }

      const buildingConfig = BUILDINGS[building.type as BuildingType];
      if (buildingConfig.minTier > village.tier) { callback({ success: false, error: `Palier ${buildingConfig.minTier} requis` }); return; }

      // La bibliothèque n'est pas améliorable.
      if (building.type === 'library') {
        callback({ success: false, error: 'La bibliothèque ne peut pas être améliorée.' }); return;
      }
      // Niveau max 10 pour les bâtiments de ressources (l'Hôtel de Ville garde sa propre progression).
      if (building.type === 'forge') {
        if (building.level >= 5) { callback({ success: false, error: 'Forge déjà au niveau maximum (5).' }); return; }
      } else if (building.type !== 'town_hall' && building.level >= 10) {
        callback({ success: false, error: 'Niveau maximum atteint (10).' }); return;
      }

      // La Forge coûte TRÈS cher : surtout de l'or, croissant fortement par niveau.
      const cost = building.type === 'forge'
        ? forgeUpgradeCost(building.level)
        : getBuildingUpgradeCost(building.type as BuildingType, building.level);
      const resources = tickResources(village.id);

      for (const res of RESOURCES) {
        if ((resources[res] || 0) < cost[res]) {
          callback({ success: false, error: `Ressources insuffisantes: ${res}` }); return;
        }
      }

      const newRes: Record<string, number> = {};
      for (const res of RESOURCES) newRes[res] = (resources[res] || 0) - cost[res];
      updateResources(village.id, newRes.stone, newRes.iron, newRes.gold, newRes.food, newRes.wood, newRes.magic_energy);

      const newLevel = building.level + 1;
      const newMaxWorkers = getMaxWorkers(building.type as BuildingType, newLevel);
      db.prepare('UPDATE buildings SET level = ?, max_workers = ? WHERE id = ?').run(newLevel, newMaxWorkers, data.buildingId);

      if (building.type === 'town_hall') {
        const newTier = getTierForLevel(newLevel);
        if (newTier > village.tier) {
          db.prepare('UPDATE villages SET tier = ?, town_hall_level = ? WHERE id = ?').run(newTier, newLevel, village.id);
          socket.emit('notification', { type: 'tier_up', message: `Votre village atteint le Palier ${newTier} !`, tier: newTier });
        } else {
          db.prepare('UPDATE villages SET town_hall_level = ? WHERE id = ?').run(newLevel, village.id);
        }
      }

      callback({ success: true, state: getFullVillageState(player.id) });
      socket.emit('notification', { type: 'building_upgraded', message: `${buildingConfig.name} amélioré au niveau ${newLevel} !` });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- BUILD NEW ----
  socket.on('build_new', (data: { type: BuildingType }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const buildingConfig = BUILDINGS[data.type];
      if (!buildingConfig) { callback({ success: false, error: 'Type invalide' }); return; }
      if (buildingConfig.minTier > village.tier) { callback({ success: false, error: `Palier ${buildingConfig.minTier} requis` }); return; }

      const tierConfig = getTierConfig(village.tier);
      const currentCount = getBuildings(village.id).filter(b => b.type === data.type).length;

      // Règle spéciale FORGE : 1 forge à l'Hôtel de Ville 7, 2e forge à l'HDV 14.
      if (data.type === 'forge') {
        const thl = village.town_hall_level || 1;
        const allowedForges = thl >= 14 ? 2 : thl >= 7 ? 1 : 0;
        if (allowedForges === 0) { callback({ success: false, error: 'Forge disponible à l\'Hôtel de Ville niveau 7.' }); return; }
        if (currentCount >= allowedForges) {
          callback({ success: false, error: thl < 14 ? '2e forge à l\'Hôtel de Ville niveau 14.' : 'Nombre maximum de forges atteint.' }); return;
        }
      } else if (currentCount >= tierConfig.maxBuildings[data.type]) {
        callback({ success: false, error: 'Nombre maximum atteint' }); return;
      }

      const cost = getBuildingUpgradeCost(data.type, 0);
      const resources = tickResources(village.id);

      for (const res of RESOURCES) {
        if ((resources[res] || 0) < cost[res]) {
          callback({ success: false, error: `Ressources insuffisantes: ${res}` }); return;
        }
      }

      const newRes: Record<string, number> = {};
      for (const res of RESOURCES) newRes[res] = (resources[res] || 0) - cost[res];
      updateResources(village.id, newRes.stone, newRes.iron, newRes.gold, newRes.food, newRes.wood, newRes.magic_energy);

      // La Forge n'emploie PAS d'ouvriers : c'est un atelier de reroll/transfert.
      const maxW = data.type === 'forge' ? 0 : getMaxWorkers(data.type, 1);
      db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, 0, ?)')
        .run(genId(), village.id, data.type, maxW);

      callback({ success: true, state: getFullVillageState(player.id) });
      socket.emit('notification', { type: 'building_built', message: `${buildingConfig.name} construit !` });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- ASSIGN WORKERS ----
  socket.on('assign_workers', (data: { buildingId: string; workers: number }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(data.buildingId) as any;
      if (!building) { callback({ success: false, error: 'Bâtiment introuvable' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village || building.village_id !== village.id) { callback({ success: false, error: 'Pas votre bâtiment' }); return; }

      if (building.type === 'forge') { callback({ success: false, error: 'La Forge ne reçoit pas d\'ouvriers — elle sert au reroll et au transfert de statistiques.' }); return; }
      if (data.workers < 0 || data.workers > building.max_workers) {
        callback({ success: false, error: `0 à ${building.max_workers} travailleurs` }); return;
      }

      // Réserve d'ouvriers partagée : la somme assignée ne peut dépasser le pool possédé.
      const allBuildings = getBuildings(village.id);
      const usedElsewhere = allBuildings
        .filter((b: any) => b.id !== building.id)
        .reduce((sum: number, b: any) => sum + (b.workers_assigned || 0), 0);
      const pool = village.worker_pool ?? 10;
      if (usedElsewhere + data.workers > pool) {
        const free = pool - usedElsewhere;
        callback({ success: false, error: `Réserve insuffisante : ${free} ouvrier(s) disponible(s)` }); return;
      }

      db.prepare('UPDATE buildings SET workers_assigned = ? WHERE id = ?').run(data.workers, data.buildingId);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- ACHETER UN OUVRIER (avec de l'or) ----
  socket.on('buy_worker', (_data: any, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const pool = village.worker_pool ?? 10;
      const cap = getWorkerPoolCap(village.town_hall_level || 1);
      if (pool >= cap) {
        callback({ success: false, error: `Limite atteinte (${cap}). Améliorez l'Hôtel de Ville.` }); return;
      }

      const cost = getWorkerPurchaseCost(pool);
      const resources = tickResources(village.id);
      if ((resources.gold || 0) < cost) {
        callback({ success: false, error: `Il faut ${cost} or` }); return;
      }

      updateResources(
        village.id,
        resources.stone, resources.iron, resources.gold - cost,
        resources.food, resources.wood, resources.magic_energy
      );
      db.prepare('UPDATE villages SET worker_pool = ? WHERE id = ?').run(pool + 1, village.id);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- RECRUIT TROOPS ----
  socket.on('recruit_troops', (data: { type: TroopType; count: number }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const troopConfig = TROOPS[data.type];
      if (!troopConfig) { callback({ success: false, error: 'Type invalide' }); return; }
      if (troopConfig.minTier > village.tier) { callback({ success: false, error: `Palier ${troopConfig.minTier} requis` }); return; }

      // La caserne n'est plus requise : recrutement disponible directement.

      const existingTroop = db.prepare('SELECT * FROM troops WHERE village_id = ? AND type = ?').get(village.id, data.type) as any;
      const existingCount = existingTroop ? existingTroop.count : 0;

      const cost = getTroopCost(data.type, data.count, existingCount);
      const resources = tickResources(village.id);

      for (const res of RESOURCES) {
        if ((resources[res] || 0) < cost[res]) {
          callback({ success: false, error: `Ressources insuffisantes: ${res}` }); return;
        }
      }

      const newRes: Record<string, number> = {};
      for (const res of RESOURCES) newRes[res] = (resources[res] || 0) - cost[res];
      updateResources(village.id, newRes.stone, newRes.iron, newRes.gold, newRes.food, newRes.wood, newRes.magic_energy);

      if (existingTroop) {
        db.prepare('UPDATE troops SET count = count + ? WHERE id = ?').run(data.count, existingTroop.id);
      } else {
        db.prepare('INSERT INTO troops (id, village_id, type, count, level) VALUES (?, ?, ?, ?, 1)').run(genId(), village.id, data.type, data.count);
      }

      callback({ success: true, state: getFullVillageState(player.id) });
      socket.emit('notification', { type: 'troops_recruited', message: `${data.count} ${troopConfig.name}(s) recruté(s) !` });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- AMÉLIORER UN TYPE DE TROUPE ----
  socket.on('upgrade_troop', (data: { type: TroopType }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const troopConfig = TROOPS[data.type];
      if (!troopConfig) { callback({ success: false, error: 'Type invalide' }); return; }

      const troop = db.prepare('SELECT * FROM troops WHERE village_id = ? AND type = ?').get(village.id, data.type) as any;
      if (!troop || troop.count <= 0) { callback({ success: false, error: 'Recrutez d\'abord cette unité' }); return; }

      const currentLevel = troop.level || 1;
      if (currentLevel >= TROOP_MAX_LEVEL) { callback({ success: false, error: `Niveau max (${TROOP_MAX_LEVEL}) atteint` }); return; }

      const cost = getTroopUpgradeCost(data.type, currentLevel);
      const resources = tickResources(village.id);
      for (const res of RESOURCES) {
        if ((resources[res] || 0) < cost[res]) {
          callback({ success: false, error: `Ressources insuffisantes : ${res}` }); return;
        }
      }

      const newRes: Record<string, number> = {};
      for (const res of RESOURCES) newRes[res] = (resources[res] || 0) - cost[res];
      updateResources(village.id, newRes.stone, newRes.iron, newRes.gold, newRes.food, newRes.wood, newRes.magic_energy);

      db.prepare('UPDATE troops SET level = ? WHERE id = ?').run(currentLevel + 1, troop.id);
      callback({ success: true, state: getFullVillageState(player.id) });
      socket.emit('notification', { type: 'troop_upgraded', message: `${troopConfig.name} amélioré au niveau ${currentLevel + 1} !` });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- SETUP DE COMBAT (le client simule en tour par tour) ----
  socket.on('battle_setup', (data: { mode: 'campaign' | 'tower' | 'boss'; chapter?: number; episode?: number; multiplier?: number; bossIndex?: number }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const hero = getHero(player.id);
      const pb = getPrestigeBonuses(player.prestige_count);
      const heroStats = {
        name: hero.name, level: hero.level,
        attack: Math.round(hero.attack * (1 + pb.heroBonus)),
        defense: Math.round(hero.defense * (1 + pb.heroBonus)),
        hp: Math.round(hero.hp * (1 + pb.heroBonus)),
        magic: Math.round(hero.magic * (1 + pb.heroBonus)),
        critChance: totalCritChance(player.id, hero.crit_level || 0),
        critMult: critMultForPlayer(player.id),
      };
      const skillLevels = JSON.parse(hero.skills || '{}');

      const villageTroops = getTroops(village.id);
      const troops = villageTroops.map((t: any) => ({ type: t.type, count: t.count, level: t.level || 1 }));

      let enemyTroops: any[] = [];
      let enemyHero: any = { level: 1, attack: 10, defense: 10, hp: 100 };
      let label = 'Ennemi';
      let bossIndex: number | null = null;

      if (data.mode === 'campaign') {
        const lvl = generateCampaignLevel(data.chapter || 1, data.episode || 1);
        enemyTroops = lvl.enemyTroops; enemyHero = lvl.enemyHero;
        label = `Chapitre ${data.chapter}-${data.episode}`;
      } else if (data.mode === 'tower') {
        const tp = db.prepare('SELECT * FROM tower_progress WHERE player_id = ?').get(player.id) as any;
        const mult = data.multiplier || 1;
        const floorsByMult = tp ? JSON.parse(tp.floors_by_mult || '{}') : {};
        const floor = (floorsByMult[String(mult)] || 0) + 1;
        const lvl = generateTowerFloor(floor, mult);
        enemyTroops = lvl.enemyTroops; enemyHero = lvl.enemyHero;
        label = `Tour — étage ${floor} (x${mult})`;
      } else {
        const idx = data.bossIndex || 1;
        const bossMult = Math.max(1, Math.floor(data.multiplier || 1));
        const boss = generateBoss(idx, 1, bossMult);
        enemyTroops = boss.enemyTroops; enemyHero = boss.enemyHero;
        label = `${boss.bossName || `Boss ${idx}`}${bossMult > 1 ? ` (x${bossMult})` : ''}`;
        bossIndex = idx;
      }

      callback({ success: true, setup: { heroStats, skillLevels, troops, enemyTroops, enemyHero, label, bossIndex } });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CAMPAIGN BATTLE ----
  socket.on('campaign_battle', (data: { chapter: number; episode: number; troops: Record<string, number>; clientResult?: { victory: boolean; survivingTroops?: Record<string, number> } }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const progress = db.prepare('SELECT * FROM campaign_progress WHERE player_id = ?').get(player.id) as any;
      if (!progress) { callback({ success: false, error: 'Progression introuvable' }); return; }

      if (data.chapter > progress.chapter || (data.chapter === progress.chapter && data.episode > progress.episode)) {
        callback({ success: false, error: 'Niveau non débloqué' }); return;
      }

      const villageTroops = getTroops(village.id);
      const troopLevels: Record<string, number> = {};
      villageTroops.forEach((t: any) => { troopLevels[t.type] = t.level || 1; });
      for (const [type, count] of Object.entries(data.troops)) {
        const vt = villageTroops.find(t => t.type === type);
        if (!vt || vt.count < count) {
          callback({ success: false, error: `Troupes insuffisantes: ${type}` }); return;
        }
      }

      const hero = getHero(player.id);
      const level = generateCampaignLevel(data.chapter, data.episode);
      const prestigeBonus = getPrestigeBonuses(player.prestige_count);

      // Niveau DÉJÀ réussi (rejoué) : la renommée est fortement réduite,
      // plafonnée à 200 et croissante selon le chapitre (20 × chapitre, max 200).
      const isReplay = (data.chapter < progress.chapter)
        || (data.chapter === progress.chapter && data.episode < progress.episode);
      const replayRenown = Math.min(200, data.chapter * 20);
      const effectiveRenown = isReplay ? replayRenown : level.renownReward;

      const result = resolveCombat(
        data.troops,
        { attack: hero.attack * (1 + prestigeBonus.heroBonus), defense: hero.defense * (1 + prestigeBonus.heroBonus), hp: hero.hp, magic: hero.magic, level: hero.level },
        level.enemyTroops, level.enemyHero, level.rewards, effectiveRenown,
        (data.chapter - 1) * 10 + data.episode, 'campaign', 1, troopLevels, data.clientResult || null, null, buffMultiplier(player.id, 'magic_find')
      );

      // Apply results
      for (const [type, count] of Object.entries(result.survivingTroops)) {
        db.prepare('UPDATE troops SET count = ? WHERE village_id = ? AND type = ?').run(count, village.id, type);
      }

      const resources = tickResources(village.id);
      const caps = getResourceCaps(village.tier, village.town_hall_level || 1);
      const nr: Record<string, number> = {};
      const lootBuff = buffMultiplier(player.id, 'loot_boost');
      const renownBuff = buffMultiplier(player.id, 'renown_boost');
      const xpBuff = buffMultiplier(player.id, 'xp_boost');
      for (const res of RESOURCES) nr[res] = Math.min(caps[res], (resources[res] || 0) + Math.floor((result.resourcesGained[res] || 0) * lootBuff));
      updateResources(village.id, nr.stone, nr.iron, nr.gold, nr.food, nr.wood, nr.magic_energy);

      result.renownGained = Math.floor(result.renownGained * renownBuff);
      db.prepare('UPDATE players SET renown = renown + ? WHERE id = ?').run(result.renownGained, player.id);

      // Hero XP
      // Reflète les boosts dans le résultat affiché (l XP et les ressources réellement accordées).
      result.xpGained = Math.floor(result.xpGained * xpBuff);
      if (result.resourcesGained) for (const r of RESOURCES) result.resourcesGained[r] = Math.floor((result.resourcesGained[r] || 0) * lootBuff);
      const newXp = hero.xp + result.xpGained;
      let newLevel = hero.level;
      let newXpRemaining = newXp;
      let skillPointsGained = 0;
      while (newXpRemaining >= heroXpForLevel(newLevel)) {
        newXpRemaining -= heroXpForLevel(newLevel);
        newLevel++;
        skillPointsGained++;
      }
      const newStats = heroStatsForLevel(newLevel);
      db.prepare('UPDATE heroes SET level = ?, xp = ?, skill_points = skill_points + ?, attack = ?, defense = ?, hp = ?, magic = ? WHERE player_id = ?')
        .run(newLevel, newXpRemaining, skillPointsGained, newStats.attack, newStats.defense, newStats.hp, newStats.magic, player.id);
      applyEquippedHeroStats(player.id);

      if (result.specialDrop) {
        db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(genId(), player.id, result.specialDrop.itemType || 'armor_chest', result.specialDrop.name, result.specialDrop.rarity, JSON.stringify(result.specialDrop.effects), (result.specialDrop.effects as any).__source || 'drop');
      }

      if (result.victory) {
        // Boss du chapitre (épisode 10) : donne l'item de collection dédié.
        if (data.episode === CAMPAIGN_EPISODES_PER_CHAPTER) {
          grantCampaignBossItem(player.id, data.chapter);
          // Pour le résumé de fin de combat côté client.
          (result as any).campaignBossItem = {
            name: campaignBossItemName(data.chapter),
            icon: `/campaign_items/${data.chapter}.png`,
            rarity: 'legendary',
          };
        }
        if (data.chapter === progress.chapter && data.episode === progress.episode) {
          const nextEpisode = data.episode + 1;
          const nextChapter = nextEpisode > CAMPAIGN_EPISODES_PER_CHAPTER ? data.chapter + 1 : data.chapter;
          const finalEpisode = nextEpisode > CAMPAIGN_EPISODES_PER_CHAPTER ? 1 : nextEpisode;
          if (nextChapter <= CAMPAIGN_CHAPTERS) {
            db.prepare('UPDATE campaign_progress SET chapter = ?, episode = ? WHERE player_id = ?').run(nextChapter, finalEpisode, player.id);
          }
        }
      }

      callback({ success: true, result, state: getFullVillageState(player.id) });
      if (result.victory) socket.emit('notification', { type: 'victory', message: `Victoire ! +${result.renownGained} Renommée` });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ============================================================
  // CAMPAGNE HÉROS SEUL — combats héros vs ennemi unique (sans armée).
  // 10 chapitres × 10 épisodes. Équilibré et un peu dur. Beaucoup d'XP héros
  // et de renommée, croissant avec la progression. Activable depuis l'admin.
  // ============================================================
  const HERO_CAMPAIGN_CH = 10;
  const HERO_CAMPAIGN_EP = 10;
  function heroCampaignProgress(player: any): { chapter: number; episode: number } {
    try { const p = JSON.parse(player.hero_campaign || ''); if (p && p.chapter) return p; } catch {}
    return { chapter: 1, episode: 1 };
  }
  // Ennemi solo : un "héros" adverse ÉCRASANT, calé sur chapitre/épisode.
  function heroCampaignEnemy(chapter: number, episode: number, playerHeroLevel: number) {
    const stage = (chapter - 1) * HERO_CAMPAIGN_EP + episode; // 1..100
    // EXTRÊMEMENT dur : niveau très au-dessus + montée brutale.
    const base = heroStatsForLevel(Math.max(12, playerHeroLevel + 20 + stage * 4));
    const diff = 3.5 + stage * 0.5; // difficulté écrasante
    return {
      level: Math.max(12, playerHeroLevel + 20 + stage * 4),
      attack: Math.floor(base.attack * diff * 3.0),
      defense: Math.floor(base.defense * diff * 2.4),
      hp: Math.floor(base.hp * diff * 4.0),
      magic: Math.floor(base.magic * diff * 2.4),
    };
  }
  function heroCampaignRewards(chapter: number, episode: number) {
    const stage = (chapter - 1) * HERO_CAMPAIGN_EP + episode;
    // Renommée faible, XP énorme (le but du mode), ressources TRÈS réduites.
    return {
      renown: Math.floor(20 + stage * 6),
      xp: Math.floor(200 + stage * stage * 12),         // énorme XP en fin de campagne
      resources: Math.floor(15 + stage * 2),            // ressources minimes
    };
  }

  socket.on('hero_campaign_info', (_data, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      callback({ success: true, enabled: heroCampaignEnabled(), progress: heroCampaignProgress(fresh), chapters: HERO_CAMPAIGN_CH, episodes: HERO_CAMPAIGN_EP });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('hero_campaign_setup', (data: { chapter: number; episode: number }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      if (!heroCampaignEnabled()) { callback({ success: false, error: 'Mode héros désactivé.' }); return; }
      const hero = getHero(player.id);
      const pb = getPrestigeBonuses(player.prestige_count);
      const heroStats = {
        name: hero.name, level: hero.level,
        attack: Math.round(hero.attack * (1 + pb.heroBonus)),
        defense: Math.round(hero.defense * (1 + pb.heroBonus)),
        hp: Math.round(hero.hp * (1 + pb.heroBonus)),
        magic: Math.round(hero.magic * (1 + pb.heroBonus)),
        critChance: totalCritChance(player.id, hero.crit_level || 0),
        critMult: critMultForPlayer(player.id),
      };
      const enemy = heroCampaignEnemy(data.chapter, data.episode, hero.level);
      callback({ success: true, setup: { heroStats, skillLevels: JSON.parse(hero.skills || '{}'), troops: [], enemyTroops: [], enemyHero: enemy, label: `Héros — ${data.chapter}-${data.episode}` } });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('hero_campaign_battle', (data: { chapter: number; episode: number; clientResult?: { victory: boolean; survivingTroops?: Record<string, number> } }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      if (!heroCampaignEnabled()) { callback({ success: false, error: 'Mode héros désactivé.' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      const prog = heroCampaignProgress(fresh);
      // Verrouillage de progression.
      if (data.chapter > prog.chapter || (data.chapter === prog.chapter && data.episode > prog.episode)) {
        callback({ success: false, error: 'Épisode non débloqué.' }); return;
      }
      const hero = getHero(player.id);
      const pb = getPrestigeBonuses(player.prestige_count);
      const enemy = heroCampaignEnemy(data.chapter, data.episode, hero.level);
      const isReplay = (data.chapter < prog.chapter) || (data.chapter === prog.chapter && data.episode < prog.episode);
      const rw = heroCampaignRewards(data.chapter, data.episode);
      const renownReward = isReplay ? Math.floor(rw.renown * 0.3) : rw.renown;
      // Grosses ressources : montant par ressource (réduit si rejeu).
      const resAmount = isReplay ? Math.floor(rw.resources * 0.3) : rw.resources;
      const rewards: Record<string, number> = {};
      for (const res of RESOURCES) rewards[res] = resAmount;

      // Combat héros SEUL : aucune troupe alliée ni ennemie.
      const result = resolveCombat(
        {}, { attack: hero.attack * (1 + pb.heroBonus), defense: hero.defense * (1 + pb.heroBonus), hp: hero.hp, magic: hero.magic, level: hero.level },
        [], enemy, rewards as any, renownReward, 1, 'campaign', 1, {}, data.clientResult || null, null
      );
      // XP héros : on remplace par le barème "campagne héros" (gros gain).
      result.xpGained = result.victory ? (isReplay ? Math.floor(rw.xp * 0.3) : rw.xp) : Math.floor(rw.xp * 0.05);

      applyOutcomeToPlayer(player.id, {}, result.survivingTroops, result);

      // Avancement si nouvel épisode réussi.
      if (result.victory && !isReplay) {
        let nc = prog.chapter, ne = prog.episode + 1;
        if (ne > HERO_CAMPAIGN_EP) { ne = 1; nc = Math.min(HERO_CAMPAIGN_CH, prog.chapter + 1); }
        // Ne dépasse jamais la fin.
        if (!(prog.chapter === HERO_CAMPAIGN_CH && prog.episode === HERO_CAMPAIGN_EP)) {
          db.prepare('UPDATE players SET hero_campaign = ? WHERE id = ?').run(JSON.stringify({ chapter: nc, episode: ne }), player.id);
        }
      }
      callback({ success: true, result, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- TOWER BATTLE ----
  socket.on('tower_battle', (data: { troops: Record<string, number>; multiplier: number; clientResult?: { victory: boolean; survivingTroops?: Record<string, number> } }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const towerProgress = db.prepare('SELECT * FROM tower_progress WHERE player_id = ?').get(player.id) as any;
      const mult = data.multiplier || 1;
      const floorsByMult = towerProgress ? JSON.parse(towerProgress.floors_by_mult || '{}') : {};
      const currentFloor = (floorsByMult[String(mult)] || 0) + 1;

      const villageTroops = getTroops(village.id);
      const troopLevels: Record<string, number> = {};
      villageTroops.forEach((t: any) => { troopLevels[t.type] = t.level || 1; });
      for (const [type, count] of Object.entries(data.troops)) {
        const vt = villageTroops.find(t => t.type === type);
        if (!vt || vt.count < count) {
          callback({ success: false, error: `Troupes insuffisantes: ${type}` }); return;
        }
      }

      const hero = getHero(player.id);
      const level = generateTowerFloor(currentFloor, data.multiplier);
      const prestigeBonus = getPrestigeBonuses(player.prestige_count);

      const result = resolveCombat(
        data.troops,
        { attack: hero.attack * (1 + prestigeBonus.heroBonus), defense: hero.defense * (1 + prestigeBonus.heroBonus), hp: hero.hp, magic: hero.magic, level: hero.level },
        level.enemyTroops, level.enemyHero, level.rewards, level.renownReward, currentFloor, 'tower', data.multiplier, troopLevels, data.clientResult || null, null, buffMultiplier(player.id, 'magic_find')
      );

      for (const [type, count] of Object.entries(result.survivingTroops)) {
        db.prepare('UPDATE troops SET count = ? WHERE village_id = ? AND type = ?').run(count, village.id, type);
      }

      const resources = tickResources(village.id);
      const caps = getResourceCaps(village.tier, village.town_hall_level || 1);
      const lootBuff = buffMultiplier(player.id, 'loot_boost');
      const renownBuff = buffMultiplier(player.id, 'renown_boost');
      const xpBuff = buffMultiplier(player.id, 'xp_boost');
      const nr: Record<string, number> = {};
      for (const res of RESOURCES) nr[res] = Math.min(caps[res], (resources[res] || 0) + Math.floor((result.resourcesGained[res] || 0) * lootBuff));
      updateResources(village.id, nr.stone, nr.iron, nr.gold, nr.food, nr.wood, nr.magic_energy);

      result.renownGained = Math.floor(result.renownGained * renownBuff);
      db.prepare('UPDATE players SET renown = renown + ? WHERE id = ?').run(result.renownGained, player.id);

      // Reflète les boosts dans le résultat affiché (l XP et les ressources réellement accordées).
      result.xpGained = Math.floor(result.xpGained * xpBuff);
      if (result.resourcesGained) for (const r of RESOURCES) result.resourcesGained[r] = Math.floor((result.resourcesGained[r] || 0) * lootBuff);
      const newXp = hero.xp + result.xpGained;
      let newLevel = hero.level;
      let newXpRemaining = newXp;
      let skillPointsGained = 0;
      while (newXpRemaining >= heroXpForLevel(newLevel)) {
        newXpRemaining -= heroXpForLevel(newLevel);
        newLevel++;
        skillPointsGained++;
      }
      const newStats = heroStatsForLevel(newLevel);
      db.prepare('UPDATE heroes SET level = ?, xp = ?, skill_points = skill_points + ?, attack = ?, defense = ?, hp = ?, magic = ? WHERE player_id = ?')
        .run(newLevel, newXpRemaining, skillPointsGained, newStats.attack, newStats.defense, newStats.hp, newStats.magic, player.id);
      applyEquippedHeroStats(player.id);

      if (result.specialDrop) {
        db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(genId(), player.id, result.specialDrop.itemType || 'armor_chest', result.specialDrop.name, result.specialDrop.rarity, JSON.stringify(result.specialDrop.effects), (result.specialDrop.effects as any).__source || 'drop');
      }

      let resetToZero = false;
      if (result.victory) {
        const bestFloor = towerProgress ? Math.max(towerProgress.best_floor, currentFloor) : currentFloor;
        floorsByMult[String(mult)] = currentFloor;
        if (towerProgress) {
          db.prepare('UPDATE tower_progress SET current_floor = ?, best_floor = ?, floors_by_mult = ? WHERE player_id = ?').run(currentFloor, bestFloor, JSON.stringify(floorsByMult), player.id);
        } else {
          db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor, floors_by_mult) VALUES (?, ?, ?, ?, ?)').run(genId(), player.id, currentFloor, bestFloor, JSON.stringify(floorsByMult));
        }
      } else {
        // DÉFAITE dans la tour : reset SEULEMENT si le joueur avait déjà atteint
        // l'étage 10 ou plus sur ce multiplicateur. En dessous de 10, aucun reset
        // (on conserve la progression et on pourra réessayer le même étage).
        const reachedBefore = currentFloor - 1; // étage validé avant ce combat
        if (reachedBefore >= 10) {
          resetToZero = true;
          floorsByMult[String(mult)] = 0;
          if (towerProgress) {
            db.prepare('UPDATE tower_progress SET current_floor = 0, floors_by_mult = ? WHERE player_id = ?').run(JSON.stringify(floorsByMult), player.id);
          } else {
            db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor, floors_by_mult) VALUES (?, ?, 0, 0, ?)').run(genId(), player.id, JSON.stringify(floorsByMult));
          }
        }
        // Sinon : on ne touche pas floorsByMult, la progression reste intacte.
      }

      callback({ success: true, result, state: getFullVillageState(player.id), floor: currentFloor, resetToZero });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- TOWER: remettre à 0 l'étage d'UN multiplicateur choisi ----
  socket.on('tower_reset', (data: { multiplier: number }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const tp = db.prepare('SELECT * FROM tower_progress WHERE player_id = ?').get(player.id) as any;
      const mult = String(data.multiplier || 1);
      const floorsByMult = tp ? JSON.parse(tp.floors_by_mult || '{}') : {};
      // Reset manuel autorisé UNIQUEMENT si l'étage atteint ≥ 10 sur ce multiplicateur.
      if ((floorsByMult[mult] || 0) < 10) {
        callback({ success: false, error: 'Reset possible seulement à partir de l\'étage 10.' }); return;
      }
      // Reset complet : on repart de l'étage 0 (prochain combat = étage 1).
      floorsByMult[mult] = 0;
      if (tp) {
        db.prepare('UPDATE tower_progress SET floors_by_mult = ? WHERE player_id = ?').run(JSON.stringify(floorsByMult), player.id);
      } else {
        db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor, floors_by_mult) VALUES (?, ?, 0, 0, ?)').run(genId(), player.id, JSON.stringify(floorsByMult));
      }

      // Réinitialise aussi les salons coop TOUR ouverts par ce joueur, au même
      // multiplicateur : leur étage repart à 1, et on prévient les membres.
      const rooms = db.prepare(`SELECT * FROM party_rooms WHERE host_id = ? AND mode = 'tower' AND status = 'waiting'`).all(player.id) as any[];
      for (const room of rooms) {
        if ((room.multiplier || 1) !== Number(data.multiplier || 1)) continue;
        db.prepare('UPDATE party_rooms SET target = 1, floors_cleared = 0 WHERE id = ?').run(room.id);
        try { broadcastRoom(room.id); } catch {}
      }

      callback({ success: true, state: getFullVillageState(player.id), resetFloor: 0 });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });
  socket.on('tower_create_room', (data: { multiplier: number }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const roomId = genId();
      db.prepare('INSERT INTO tower_rooms (id, host_id, multiplier, players, status) VALUES (?, ?, ?, ?, ?)')
        .run(roomId, player.id, data.multiplier, JSON.stringify([player.id]), 'waiting');

      socket.join(`tower_${roomId}`);
      callback({ success: true, roomId });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- TOWER CO-OP: Join Room ----
  socket.on('tower_join_room', (data: { roomId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const room = db.prepare('SELECT * FROM tower_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) { callback({ success: false, error: 'Salon introuvable' }); return; }
      if (room.status !== 'waiting') { callback({ success: false, error: 'Partie déjà en cours' }); return; }

      const players = JSON.parse(room.players);
      if (players.length >= 4) { callback({ success: false, error: 'Salon complet' }); return; }

      players.push(player.id);
      db.prepare('UPDATE tower_rooms SET players = ? WHERE id = ?').run(JSON.stringify(players), data.roomId);

      socket.join(`tower_${data.roomId}`);
      io.to(`tower_${data.roomId}`).emit('tower_room_update', { players: players.length, maxPlayers: 4 });
      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ============================================================
  // BOSS GAUNTLET + MULTIPLAYER PARTY (tower & boss, 1-4 players)
  // ============================================================

  // Apply a combat outcome to a single player's account.
  function applyOutcomeToPlayer(playerId: string, troopsUsed: Record<string, number>,
    survivors: Record<string, number>, result: any) {
    const v = getVillageByPlayer(playerId);
    if (!v) return;
    // surviving troops: subtract losses (troopsUsed - survivors) from totals
    for (const [type, used] of Object.entries(troopsUsed)) {
      const lost = Math.max(0, (used as number) - (survivors[type] || 0));
      if (lost > 0) {
        const vt = db.prepare('SELECT * FROM troops WHERE village_id = ? AND type = ?').get(v.id, type) as any;
        if (vt) db.prepare('UPDATE troops SET count = ? WHERE id = ?').run(Math.max(0, vt.count - lost), vt.id);
      }
    }
    if (!result.victory) return;
    const res = tickResources(v.id);
    const caps = getResourceCaps(v.tier, v.town_hall_level || 1);
    const lootBuff = buffMultiplier(playerId, 'loot_boost');
    const renownBuff = buffMultiplier(playerId, 'renown_boost');
    const xpBuff = buffMultiplier(playerId, 'xp_boost');
    const nr: Record<string, number> = {};
    for (const r of RESOURCES) nr[r] = Math.min(caps[r], (res[r] || 0) + Math.floor((result.resourcesGained[r] || 0) * lootBuff));
    updateResources(v.id, nr.stone, nr.iron, nr.gold, nr.food, nr.wood, nr.magic_energy);
    result.renownGained = Math.floor(result.renownGained * renownBuff);
      db.prepare('UPDATE players SET renown = renown + ? WHERE id = ?').run(result.renownGained, playerId);
    // hero xp
    const hero = getHero(playerId);
    let newXp = hero.xp + Math.floor(result.xpGained * xpBuff), newLevel = hero.level, sp = 0;
    while (newXp >= heroXpForLevel(newLevel)) { newXp -= heroXpForLevel(newLevel); newLevel++; sp++; }
    const st = heroStatsForLevel(newLevel);
    db.prepare('UPDATE heroes SET level=?, xp=?, skill_points=skill_points+?, attack=?, defense=?, hp=?, magic=? WHERE player_id=?')
      .run(newLevel, newXp, sp, st.attack, st.defense, st.hp, st.magic, playerId);
    applyEquippedHeroStats(playerId);
    if (result.specialDrop) {
      db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, source) VALUES (?,?,?,?,?,?,?)')
        .run(genId(), playerId, result.specialDrop.itemType || 'armor_chest', result.specialDrop.name, result.specialDrop.rarity, JSON.stringify(result.specialDrop.effects), (result.specialDrop.effects as any).__source || 'drop');
    }
  }

  function pushStateTo(playerId: string) {
    const p = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as any;
    if (p && p.socket_id) io.to(p.socket_id).emit('state_update', getFullVillageState(playerId));
  }

  // ---- BOSS: solo battle ----
  socket.on('boss_battle', (data: { bossIndex: number; troops: Record<string, number>; multiplier?: number; clientResult?: { victory: boolean; survivingTroops?: Record<string, number> } }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const village = getVillageByPlayer(player.id);
      if (!village) return callback({ success: false, error: 'Village introuvable' });

      const prog = db.prepare('SELECT * FROM boss_progress WHERE player_id = ?').get(player.id) as any;
      const highest = prog ? prog.highest_boss : 0;
      const idx = data.bossIndex;
      if (idx > highest + 1) return callback({ success: false, error: 'Boss verrouillé' });
      const bossMult = Math.max(1, Math.floor(data.multiplier || 1));

      const villageTroops = getTroops(village.id);
      const troopLevels: Record<string, number> = {};
      villageTroops.forEach((t: any) => { troopLevels[t.type] = t.level || 1; });
      for (const [type, count] of Object.entries(data.troops)) {
        const vt = villageTroops.find(t => t.type === type);
        if (!vt || vt.count < (count as number)) return callback({ success: false, error: `Troupes insuffisantes` });
      }

      const hero = getHero(player.id);
      const pb = getPrestigeBonuses(player.prestige_count);
      const boss = generateBoss(idx, 1, bossMult);
      const isDailyBoss = idx === dailyBossIndex();
      // Taux de drop signature : potion × pity × (×2 si boss du jour). Cumulable.
      const dropMult = buffMultiplier(player.id, 'boss_drop_boost') * bossPityMult(player, idx) * (isDailyBoss ? 2 : 1);
      const result = resolveCombat(
        data.troops,
        { attack: hero.attack * (1 + pb.heroBonus), defense: hero.defense * (1 + pb.heroBonus), hp: hero.hp, magic: hero.magic, level: hero.level },
        boss.enemyTroops, boss.enemyHero, boss.rewards, boss.renownReward, idx, 'boss', idx, troopLevels, data.clientResult || null, { bossIndex: idx }, dropMult
      );
      // Met à jour le pity : reset si l'objet est tombé, +1 sinon (sur victoire).
      if (result.victory) {
        updateBossPity(player.id, idx, !!result.specialDrop);
      }
      // Boss du jour : renommée x5 et ressources x3 (en plus du reste).
      if (isDailyBoss && result.victory) {
        result.renownGained = Math.floor((result.renownGained || 0) * DAILY_BOSS_RENOWN_MULT);
        if (result.resourcesGained) {
          for (const k of Object.keys(result.resourcesGained)) {
            result.resourcesGained[k] = Math.floor((result.resourcesGained[k] || 0) * DAILY_BOSS_RESOURCE_MULT);
          }
        }
      }
      applyOutcomeToPlayer(player.id, data.troops, result.survivingTroops, result);

      if (result.victory && idx > highest) {
        if (prog) db.prepare('UPDATE boss_progress SET highest_boss = ? WHERE player_id = ?').run(idx, player.id);
        else db.prepare('INSERT INTO boss_progress (id, player_id, highest_boss) VALUES (?,?,?)').run(genId(), player.id, idx);
      }
      callback({ success: true, result, bossName: boss.bossName, bossIndex: idx, bossMultiplier: bossMult, dailyBoss: isDailyBoss, pityBonus: Math.round((bossPityMult(db.prepare('SELECT boss_pity FROM players WHERE id = ?').get(player.id), idx) - 1) * 100), state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: create room (mode = 'tower' | 'boss') ----
  socket.on('party_create', (data: { mode: 'tower' | 'boss'; target: number; multiplier?: number }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const roomId = genId().slice(0, 6).toUpperCase();
      const mult = Math.max(1, Math.min(25, data.multiplier || 1));
      // En mode TOUR, l'étage de départ est lié à la progression SOLO du joueur
      // pour ce multiplicateur (floors_by_mult). Coop et solo partagent le même compteur.
      let startTarget = data.target || 1;
      if (data.mode === 'tower') {
        const tp = db.prepare('SELECT * FROM tower_progress WHERE player_id = ?').get(player.id) as any;
        let fbm: Record<string, number> = {};
        try { fbm = tp ? JSON.parse(tp.floors_by_mult || '{}') : {}; } catch {}
        startTarget = (fbm[String(mult)] || 0) + 1;
      }
      db.prepare('INSERT INTO party_rooms (id, mode, host_id, target, players, contributions, status, multiplier, floors_cleared) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(roomId, data.mode, player.id, startTarget, JSON.stringify([player.id]), '{}', 'waiting', mult, 0);
      socket.join(`party_${roomId}`);
      callback({ success: true, roomId, mode: data.mode, target: startTarget, multiplier: mult });
      broadcastRoom(roomId);
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: join room ----
  socket.on('party_join', (data: { roomId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback({ success: false, error: 'Salon introuvable' });
      if (room.status !== 'waiting') return callback({ success: false, error: 'Partie déjà lancée' });
      const players = JSON.parse(room.players);
      if (players.includes(player.id)) { socket.join(`party_${data.roomId}`); return callback({ success: true, roomId: data.roomId, mode: room.mode, target: room.target }); }
      if (players.length >= 4) return callback({ success: false, error: 'Salon complet (4 max)' });
      players.push(player.id);
      db.prepare('UPDATE party_rooms SET players = ? WHERE id = ?').run(JSON.stringify(players), data.roomId);
      socket.join(`party_${data.roomId}`);
      callback({ success: true, roomId: data.roomId, mode: room.mode, target: room.target });
      broadcastRoom(data.roomId);
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: l'hôte change la cible du salon (ex. choisir un autre boss) ----
  socket.on('party_set_target', (data: { roomId: string; target: number }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback && callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback && callback({ success: false, error: 'Salon introuvable' });
      if (room.host_id !== player.id) return callback && callback({ success: false, error: 'Seul l\'hôte peut changer la cible' });
      if (room.status !== 'waiting') return callback && callback({ success: false, error: 'Partie déjà lancée' });
      db.prepare('UPDATE party_rooms SET target = ? WHERE id = ?').run(data.target, data.roomId);
      if (callback) callback({ success: true, target: data.target });
      broadcastRoom(data.roomId);
    } catch (err: any) { if (callback) callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: set my troop contribution ----
  socket.on('party_contribute', (data: { roomId: string; troops: Record<string, number> }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback({ success: false, error: 'Salon introuvable' });
      // Borne la contribution au stock réel du joueur (jamais plus que possédé).
      const village = getVillageByPlayer(player.id);
      const stock: Record<string, number> = {};
      if (village) for (const t of getTroops(village.id)) stock[t.type] = (stock[t.type] || 0) + (t.count || 0);
      const safe: Record<string, number> = {};
      for (const [type, want] of Object.entries(data.troops || {})) {
        const v = Math.min(Number(want) || 0, stock[type] || 0);
        if (v > 0) safe[type] = v;
      }
      const contrib = JSON.parse(room.contributions || '{}');
      contrib[player.id] = safe;
      db.prepare('UPDATE party_rooms SET contributions = ? WHERE id = ?').run(JSON.stringify(contrib), data.roomId);
      callback({ success: true });
      broadcastRoom(data.roomId);
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: l'hôte invite un ami (invitation 30s) ----
  socket.on('party_invite', (data: { roomId: string; friendName: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback({ success: false, error: 'Salon introuvable' });
      if (room.host_id !== player.id) return callback({ success: false, error: 'Seul l\'hôte peut inviter' });
      if (room.status !== 'waiting') return callback({ success: false, error: 'Partie déjà lancée' });

      const players = JSON.parse(room.players);
      if (players.length >= 4) return callback({ success: false, error: 'Salon complet (4 max)' });

      const target = db.prepare('SELECT * FROM players WHERE LOWER(username) = LOWER(?)').get(String(data.friendName || '').trim()) as any;
      if (!target) return callback({ success: false, error: 'Joueur introuvable' });
      if (players.includes(target.id)) return callback({ success: false, error: 'Déjà dans le salon' });
      if (!target.online || !target.socket_id) return callback({ success: false, error: `${target.username} n'est pas en ligne` });

      // Invitation valable 30s (l'expiration côté client coupe l'affichage).
      io.to(target.socket_id).emit('party_invite', {
        roomId: room.id, mode: room.mode, host: player.username, expiresIn: 30,
      });
      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: réponse à une invitation ----
  socket.on('party_invite_respond', (data: { roomId: string; accept: boolean }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback({ success: false, error: 'Salon fermé' });
      const host = db.prepare('SELECT socket_id FROM players WHERE id = ?').get(room.host_id) as any;

      if (!data.accept) {
        if (host?.socket_id) io.to(host.socket_id).emit('party_invite_declined', { name: player.username });
        return callback({ success: true, declined: true });
      }
      if (room.status !== 'waiting') return callback({ success: false, error: 'Partie déjà lancée' });
      const players = JSON.parse(room.players);
      if (players.includes(player.id)) { socket.join(`party_${room.id}`); return callback({ success: true, roomId: room.id, mode: room.mode, target: room.target }); }
      if (players.length >= 4) return callback({ success: false, error: 'Salon complet (4 max)' });
      players.push(player.id);
      db.prepare('UPDATE party_rooms SET players = ? WHERE id = ?').run(JSON.stringify(players), room.id);
      socket.join(`party_${room.id}`);
      callback({ success: true, roomId: room.id, mode: room.mode, target: room.target, multiplier: room.multiplier || 1 });
      broadcastRoom(room.id);
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: l'hôte retire un membre ----
  socket.on('party_kick', (data: { roomId: string; targetId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback({ success: false, error: 'Salon introuvable' });
      if (room.host_id !== player.id) return callback({ success: false, error: 'Seul l\'hôte peut exclure' });
      if (data.targetId === player.id) return callback({ success: false, error: 'L\'hôte ne peut pas s\'exclure' });

      let players = JSON.parse(room.players).filter((p: string) => p !== data.targetId);
      const contrib = JSON.parse(room.contributions || '{}'); delete contrib[data.targetId];
      db.prepare('UPDATE party_rooms SET players = ?, contributions = ? WHERE id = ?')
        .run(JSON.stringify(players), JSON.stringify(contrib), room.id);

      // Avertit et sort le joueur exclu.
      const kicked = db.prepare('SELECT socket_id FROM players WHERE id = ?').get(data.targetId) as any;
      if (kicked?.socket_id) {
        io.to(kicked.socket_id).emit('party_kicked', { roomId: room.id });
        io.sockets.sockets.get(kicked.socket_id)?.leave(`party_${room.id}`);
      }
      callback({ success: true });
      broadcastRoom(room.id);
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PARTY: leave room ----
  socket.on('party_leave', (data: { roomId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (room && player) {
        let players = JSON.parse(room.players).filter((p: string) => p !== player.id);
        const contrib = JSON.parse(room.contributions || '{}'); delete contrib[player.id];
        if (players.length === 0) db.prepare('DELETE FROM party_rooms WHERE id = ?').run(data.roomId);
        else db.prepare('UPDATE party_rooms SET players = ?, contributions = ?, host_id = ? WHERE id = ?')
          .run(JSON.stringify(players), JSON.stringify(contrib), players[0], data.roomId);
        socket.leave(`party_${data.roomId}`);
        broadcastRoom(data.roomId);
      }
      if (callback) callback({ success: true });
    } catch (err: any) { if (callback) callback({ success: false, error: err.message }); }
  });

  // ============================================================
  // COMBAT COOP TOUR PAR TOUR — chaque membre joue SON héros.
  // ============================================================

  // Construit la liste des membres (troupes engagées + héros + skills).
  function buildCoopMembers(room: any) {
    const playerIds: string[] = JSON.parse(room.players);
    const contrib = JSON.parse(room.contributions || '{}');
    const members: { playerId: string; name: string; troops: Record<string, number>; troopLevels: Record<string, number>;
                     hero: any; skillLevels: Record<string, number> }[] = [];
    for (const pid of playerIds) {
      const v = getVillageByPlayer(pid); if (!v) continue;
      const troops = contrib[pid] || {};
      if ((Object.values(troops) as number[]).reduce((a, b) => a + b, 0) <= 0) continue; // pas prêt
      const vts = getTroops(v.id);
      const troopLevels: Record<string, number> = {};
      for (const [type, count] of Object.entries(troops)) {
        const vt = vts.find(t => t.type === type);
        if (!vt || vt.count < (count as number)) return { error: `Un joueur n'a pas assez de troupes` };
        troopLevels[type] = vt.level || 1;
      }
      const p = db.prepare('SELECT username FROM players WHERE id = ?').get(pid) as any;
      const h = getHero(pid);
      members.push({
        playerId: pid, name: p ? p.username : '???',
        troops, troopLevels,
        hero: { attack: h.attack, defense: h.defense, hp: h.hp, magic: h.magic, level: h.level },
        skillLevels: JSON.parse(h.skills || '{}'),
      });
    }
    return { members };
  }

  // Diffuse l'état de combat à tous les membres du salon.
  function broadcastCoopState(roomId: string) {
    const s = getCoopState(roomId);
    if (!s) return;
    io.to(`party_${roomId}`).emit('coop_state', coopPublicState(s));
  }

  // Finalise un combat coop terminé : applique récompenses + progression,
  // fait monter d'étage (mode tour) ou clôt le salon (boss/défaite).
  function finalizeCoopBattle(roomId: string) {
    const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(roomId) as any;
    const s = getCoopState(roomId);
    if (!room || !s) return;
    const built = buildCoopMembers(room);
    if ('error' in built) return;
    const members = built.members;
    const partySize = members.length;
    const roomMult = room.multiplier || 1;
    const towerMult = roomMult * (1 + (partySize - 1) * 0.6);
    const level = room.mode === 'boss'
      ? generateBoss(room.target, partySize)
      : generateTowerFloor(room.target, towerMult);

    const { victory, perMemberSurvivors } = coopOutcome(s, members);
    const result: any = {
      victory,
      resourcesGained: level.rewards,
      renownGained: level.renownReward,
      xpGained: victory ? Math.floor(20 + room.target * 10) : Math.floor(5 + room.target * 2),
      specialDrop: victory
        ? (room.mode === 'boss'
            ? (Math.random() < bossSignatureDropChance(room.target) ? generateBossSignatureDrop(room.target) : null)
            : (Math.random() < Math.min(0.95, 0.10 + room.target * 0.006) ? generateArmorDrop(room.target, 'tower', roomMult) : null))
        : null,
    };

    members.forEach((m, i) => {
      applyOutcomeToPlayer(m.playerId, m.troops, perMemberSurvivors[i], result);
      if (victory) {
        if (room.mode === 'boss') {
          const prog = db.prepare('SELECT * FROM boss_progress WHERE player_id = ?').get(m.playerId) as any;
          const hi = prog ? prog.highest_boss : 0;
          if (room.target > hi) {
            if (prog) db.prepare('UPDATE boss_progress SET highest_boss = ? WHERE player_id = ?').run(room.target, m.playerId);
            else db.prepare('INSERT INTO boss_progress (id, player_id, highest_boss) VALUES (?,?,?)').run(genId(), m.playerId, room.target);
          }
        } else {
          const tp = db.prepare('SELECT * FROM tower_progress WHERE player_id = ?').get(m.playerId) as any;
          const best = tp ? Math.max(tp.best_floor, room.target) : room.target;
          let fbm: Record<string, number> = {};
          try { fbm = tp ? JSON.parse(tp.floors_by_mult || '{}') : {}; } catch {}
          // L'étage coop est lié à la progression solo : même clé de multiplicateur.
          fbm[String(roomMult)] = room.target;
          if (tp) db.prepare('UPDATE tower_progress SET current_floor = ?, best_floor = ?, floors_by_mult = ? WHERE player_id = ?').run(room.target, best, JSON.stringify(fbm), m.playerId);
          else db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor, floors_by_mult) VALUES (?,?,?,?,?)').run(genId(), m.playerId, room.target, best, JSON.stringify(fbm));
        }
      }
    });

    const climbing = room.mode === 'tower' && victory;
    if (climbing) {
      db.prepare('UPDATE party_rooms SET target = ?, floors_cleared = floors_cleared + 1, contributions = ?, status = ? WHERE id = ?')
        .run(room.target + 1, '{}', 'waiting', roomId);
    } else {
      db.prepare('UPDATE party_rooms SET status = ? WHERE id = ?').run('done', roomId);
    }

    const payload = {
      result: { victory, resourcesGained: result.resourcesGained, renownGained: result.renownGained, specialDrop: result.specialDrop },
      mode: room.mode, target: room.target,
      nextTarget: climbing ? room.target + 1 : null,
      climbing, multiplier: roomMult,
      bossName: room.mode === 'boss' ? (level as any).bossName : undefined,
      partySize,
    };
    io.to(`party_${roomId}`).emit('party_result', payload);
    members.forEach(m => pushStateTo(m.playerId));
    clearCoopState(roomId);
    if (climbing) broadcastRoom(roomId);
    if (!climbing) setTimeout(() => { try { db.prepare('DELETE FROM party_rooms WHERE id = ?').run(roomId); } catch {} }, 30000);
  }

  // Fait avancer les phases automatiques (ennemi, troupes) et gère la fin.
  // S'arrête dès qu'on attend une action de héros, ou finalise si terminé.
  function progressCoop(roomId: string) {
    const s = getCoopState(roomId);
    if (!s) return;
    let guard = 0;
    while (guard++ < 20) {
      if (s.phase === 'won' || s.phase === 'lost') { broadcastCoopState(roomId); finalizeCoopBattle(roomId); return; }
      if (s.phase === 'hero') { broadcastCoopState(roomId); scheduleCoopTimeout(roomId); return; }
      if (s.phase === 'enemy') { coopEnemyAction(s); broadcastCoopState(roomId); continue; }
      if (s.phase === 'troops') { coopTroopsAction(s); broadcastCoopState(roomId); continue; }
    }
  }

  // Timeout du tour actif : auto-attaque basique si le joueur ne joue pas.
  function scheduleCoopTimeout(roomId: string) {
    const prev = coopTimers.get(roomId); if (prev) clearTimeout(prev);
    const s = getCoopState(roomId);
    if (!s || s.phase !== 'hero') return;
    const delay = Math.max(500, s.deadline - Date.now());
    const t = setTimeout(() => {
      const cur = getCoopState(roomId);
      if (!cur || cur.phase !== 'hero') return;
      if (!coopTurnExpired(cur)) { scheduleCoopTimeout(roomId); return; }
      const pid = coopPublicState(cur).activePlayerId;
      if (pid) {
        coopHeroAction(cur, pid, 'basic');
        io.to(`party_${roomId}`).emit('coop_log', { text: '⏳ Temps écoulé : attaque automatique.' });
        progressCoop(roomId);
      }
    }, delay);
    coopTimers.set(roomId, t);
  }

  // ---- PARTY: l'hôte démarre le combat coop ----
  socket.on('party_begin', (data: { roomId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback({ success: false, error: 'Non authentifié' });
      const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(data.roomId) as any;
      if (!room) return callback({ success: false, error: 'Salon introuvable' });
      if (room.host_id !== player.id) return callback({ success: false, error: 'Seul l\'hôte peut lancer' });
      if (getCoopState(data.roomId)) return callback({ success: false, error: 'Combat déjà en cours' });

      const built = buildCoopMembers(room);
      if ('error' in built) return callback({ success: false, error: built.error });
      const members = built.members;
      if (members.length === 0) return callback({ success: false, error: 'Aucun participant prêt' });

      const partySize = members.length;
      const roomMult = room.multiplier || 1;
      const towerMult = roomMult * (1 + (partySize - 1) * 0.6);
      const level = room.mode === 'boss'
        ? generateBoss(room.target, partySize)
        : generateTowerFloor(room.target, towerMult);
      const enemyLabel = room.mode === 'boss'
        ? ((level as any).bossName || `Boss ${room.target}`)
        : `Tour étage ${room.target} (x${roomMult})`;

      db.prepare('UPDATE party_rooms SET status = ? WHERE id = ?').run('fighting', data.roomId);

      initCoopCombat({
        roomId: data.roomId, members,
        enemyTroops: level.enemyTroops, enemyHero: level.enemyHero, enemyLabel,
      });

      io.to(`party_${data.roomId}`).emit('coop_begin', {
        bossIndex: room.mode === 'boss' ? room.target : null,
        mode: room.mode, scene: room.mode === 'boss' ? 'forest' : 'tower',
      });
      progressCoop(data.roomId);
      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- COOP: un joueur joue son héros (compétence ou attaque de base) ----
  socket.on('coop_action', (data: { roomId: string; skillId: string | 'basic' }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) return callback && callback({ success: false, error: 'Non authentifié' });
      const s = getCoopState(data.roomId);
      if (!s) return callback && callback({ success: false, error: 'Aucun combat en cours' });
      const r = coopHeroAction(s, player.id, data.skillId);
      if (!r.ok) return callback && callback({ success: false, error: r.error });
      progressCoop(data.roomId);
      callback && callback({ success: true });
    } catch (err: any) { callback && callback({ success: false, error: err.message }); }
  });

  // ---- COOP: resync (un client demande l'état courant) ----
  socket.on('coop_sync', (data: { roomId: string }, callback) => {
    const s = getCoopState(data.roomId);
    callback && callback({ success: !!s, state: s ? coopPublicState(s) : null });
  });

  function broadcastRoom(roomId: string) {
    const room = db.prepare('SELECT * FROM party_rooms WHERE id = ?').get(roomId) as any;
    if (!room) { io.to(`party_${roomId}`).emit('party_update', { closed: true }); return; }
    const ids: string[] = JSON.parse(room.players);
    const contrib = JSON.parse(room.contributions || '{}');
    const members = ids.map(pid => {
      const p = db.prepare('SELECT username FROM players WHERE id = ?').get(pid) as any;
      const tr = contrib[pid] || {};
      const total = (Object.values(tr) as number[]).reduce((a, b) => a + b, 0);
      return { playerId: pid, name: p ? p.username : '???', ready: total > 0, troopCount: total, isHost: pid === room.host_id };
    });
    io.to(`party_${roomId}`).emit('party_update', {
      roomId, mode: room.mode, target: room.target, status: room.status,
      multiplier: room.multiplier || 1, floorsCleared: room.floors_cleared || 0,
      members, maxPlayers: 4,
    });
  }

  // ---- HERO: Upgrade Skill ----
  socket.on('hero_upgrade_skill', (data: { skillId: string }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const hero = getHero(player.id);
      if (!hero) { callback({ success: false, error: 'Héros introuvable' }); return; }
      if (hero.skill_points <= 0) { callback({ success: false, error: 'Pas de points' }); return; }

      const skillConfig = HERO_SKILLS.find(s => s.id === data.skillId);
      if (!skillConfig) { callback({ success: false, error: 'Compétence introuvable' }); return; }

      const skills = JSON.parse(hero.skills || '{}');
      const currentLevel = skills[data.skillId] || 0;
      if (currentLevel >= skillConfig.maxLevel) { callback({ success: false, error: 'Compétence au max' }); return; }

      skills[data.skillId] = currentLevel + 1;
      db.prepare('UPDATE heroes SET skills = ?, skill_points = skill_points - 1 WHERE player_id = ?')
        .run(JSON.stringify(skills), player.id);

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- HERO: Equip Item ----
  socket.on('hero_equip', (data: { itemId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const item = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.itemId, player.id) as any;
      if (!item) { callback({ success: false, error: 'Objet introuvable' }); return; }

      // Une seule pièce équipée par emplacement : casque, plastron, bottes, etc.
      db.prepare('UPDATE inventory SET equipped = 0 WHERE player_id = ? AND item_type = ? AND equipped = 1')
        .run(player.id, item.item_type);
      db.prepare('UPDATE inventory SET equipped = 1 WHERE id = ?').run(data.itemId);
      applyEquippedHeroStats(player.id);

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('hero_unequip', (data: { itemId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const item = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.itemId, player.id) as any;
      if (!item) { callback({ success: false, error: 'Objet introuvable' }); return; }
      db.prepare('UPDATE inventory SET equipped = 0 WHERE id = ?').run(data.itemId);
      applyEquippedHeroStats(player.id);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- HÉROS : abandonner (supprimer) un ou plusieurs équipements ----
  socket.on('hero_discard', (data: { itemIds: string[] }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const ids = Array.isArray(data?.itemIds) ? data.itemIds : [];
      if (ids.length === 0) { callback({ success: false, error: 'Aucun objet sélectionné' }); return; }

      // Un équipement verrouillé ne peut JAMAIS être supprimé.
      const del = db.prepare('DELETE FROM inventory WHERE id = ? AND player_id = ? AND locked = 0');
      let removed = 0;
      let blocked = 0;
      for (const id of ids) {
        const changes = del.run(id, player.id).changes;
        removed += changes;
        if (changes === 0) blocked++;
      }

      // Si une pièce équipée a été supprimée, recalculer les stats.
      applyEquippedHeroStats(player.id);

      callback({ success: true, removed, blocked, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- VERROU / DÉVERROU d'un équipement (anti-suppression) ----
  // ---- FORGE : informations (niveau, coût d'amélioration, qualité) ----
  socket.on('forge_info', (_data, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const forge = getPlayerForge(player.id);
      if (!forge) { callback({ success: true, hasForge: false, maxLevel: FORGE_MAX_LEVEL }); return; }
      const lvl = forge.level || 1;
      callback({
        success: true, hasForge: true, level: lvl, maxLevel: FORGE_MAX_LEVEL,
        qualityMult: forgeQualityMult(lvl),
        nextUpgradeCost: lvl < FORGE_MAX_LEVEL ? forgeUpgradeCost(lvl) : null,
      });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- FORGE : reroll des stats d'un équipement choisi ----
  socket.on('forge_reroll', (data: { itemId: string }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const forge = getPlayerForge(player.id);
      if (!forge) { callback({ success: false, error: 'Aucune forge — disponible à l\'Hôtel de Ville niveau 7.' }); return; }
      const item = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data?.itemId, player.id) as any;
      if (!item) { callback({ success: false, error: 'Équipement introuvable' }); return; }
      let effects: Record<string, any> = {};
      try { effects = JSON.parse(item.effects || '{}'); } catch { effects = {}; }
      const rerolled = rerollItemEffects(effects, forge.level || 1);
      db.prepare('UPDATE inventory SET effects = ? WHERE id = ? AND player_id = ?').run(JSON.stringify(rerolled), data.itemId, player.id);
      // Si l'objet est équipé, recalculer les stats du héros.
      if (item.equipped) applyEquippedHeroStats(player.id);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- FORGE : transfert d'une stat d'un item source vers un item cible ----
  // L'item source est CONSOMMÉ. La stat choisie écrase celle de la cible.
  socket.on('forge_transfer', (data: { sourceId: string; targetId: string; stat: string }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const forge = getPlayerForge(player.id);
      if (!forge) { callback({ success: false, error: 'Aucune forge — disponible à l\'Hôtel de Ville niveau 7.' }); return; }
      if (data?.sourceId === data?.targetId) { callback({ success: false, error: 'Choisis deux équipements différents.' }); return; }
      if (!FORGE_STAT_KEYS.includes(data?.stat)) { callback({ success: false, error: 'Statistique invalide.' }); return; }
      const source = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.sourceId, player.id) as any;
      const target = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.targetId, player.id) as any;
      if (!source || !target) { callback({ success: false, error: 'Équipement introuvable' }); return; }
      if (source.equipped) { callback({ success: false, error: 'Déséquipe d\'abord l\'équipement source (il sera consommé).' }); return; }
      if (source.locked) { callback({ success: false, error: 'L\'équipement source est verrouillé.' }); return; }
      let sEff: Record<string, any> = {}; let tEff: Record<string, any> = {};
      try { sEff = JSON.parse(source.effects || '{}'); } catch {}
      try { tEff = JSON.parse(target.effects || '{}'); } catch {}
      const val = sEff[data.stat];
      if (typeof val !== 'number' || val === 0) { callback({ success: false, error: 'La source ne possède pas cette statistique.' }); return; }
      tEff[data.stat] = val; // transfert (écrase la valeur de la cible)
      db.prepare('UPDATE inventory SET effects = ? WHERE id = ? AND player_id = ?').run(JSON.stringify(tEff), data.targetId, player.id);
      // L'équipement source est consommé.
      db.prepare('DELETE FROM inventory WHERE id = ? AND player_id = ?').run(data.sourceId, player.id);
      if (target.equipped) applyEquippedHeroStats(player.id);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('hero_toggle_lock', (data: { itemId: string; locked?: boolean }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const item = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data?.itemId, player.id) as any;
      if (!item) { callback({ success: false, error: 'Équipement introuvable' }); return; }
      const next = typeof data?.locked === 'boolean' ? (data.locked ? 1 : 0) : (item.locked ? 0 : 1);
      db.prepare('UPDATE inventory SET locked = ? WHERE id = ? AND player_id = ?').run(next, data.itemId, player.id);
      callback({ success: true, locked: !!next, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CRITIQUE : améliore le passif de critique du héros (1 point de compétence) ----
  socket.on('hero_upgrade_crit', (_data, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const hero = getHero(player.id);
      if (!hero) { callback({ success: false, error: 'Héros introuvable' }); return; }
      if ((hero.skill_points || 0) <= 0) { callback({ success: false, error: 'Pas de point de compétence' }); return; }
      const cur = hero.crit_level || 0;
      if (cur >= CRIT_MAX_LEVEL) { callback({ success: false, error: 'Critique déjà au niveau max' }); return; }
      db.prepare('UPDATE heroes SET crit_level = ?, skill_points = skill_points - 1 WHERE player_id = ?').run(cur + 1, player.id);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CRAFT : créer un niveau d'enchantement (disponible dès le début) ----
  socket.on('craft_enchant', (data: { stat: EnchantStat }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const recipe = ENCHANT_RECIPES[data?.stat];
      if (!recipe) { callback({ success: false, error: 'Enchantement invalide' }); return; }

      // Vérifie l'or.
      const resources = tickResources(village.id);
      if ((resources.gold || 0) < recipe.gold) { callback({ success: false, error: `Il faut ${recipe.gold.toLocaleString()} or` }); return; }

      // Vérifie les items requis.
      const have = countItemsByIcon(player.id);
      for (const req of recipe.items) {
        if ((have[req.icon] || 0) < req.qty) { callback({ success: false, error: 'Items de boss insuffisants' }); return; }
      }

      // Consomme or + items.
      updateResources(village.id, resources.stone, resources.iron, resources.gold - recipe.gold, resources.food, resources.wood, resources.magic_energy);
      for (const req of recipe.items) consumeItemsByIcon(player.id, req.icon, req.qty);

      // Incrémente le stock d'enchantements du joueur.
      const enchants = JSON.parse(player.enchants || '{}');
      enchants[recipe.stat] = (enchants[recipe.stat] || 0) + 1;
      db.prepare('UPDATE players SET enchants = ? WHERE id = ?').run(JSON.stringify(enchants), player.id);

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CRAFT : appliquer un enchantement sur un équipement (empilable) ----
  socket.on('apply_enchant', (data: { itemId: string; stat: EnchantStat }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const recipe = ENCHANT_RECIPES[data?.stat];
      if (!recipe) { callback({ success: false, error: 'Enchantement invalide' }); return; }

      const item = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.itemId, player.id) as any;
      if (!item) { callback({ success: false, error: 'Équipement introuvable' }); return; }
      // Seulement sur les équipements (pas les objets de butin de boss).
      if (!String(item.item_type).startsWith('armor')) { callback({ success: false, error: 'Enchantement uniquement sur les équipements' }); return; }
      // Sécurité : refuse aussi tout objet identifié comme butin de boss.
      try {
        const ic = String(JSON.parse(item.effects || '{}').__icon || '');
        if (item.item_type === 'item' || ic.includes('boss_item_') || ic.includes('campaign_items')) {
          callback({ success: false, error: 'Enchantement uniquement sur les équipements' }); return;
        }
      } catch {}

      const enchants = JSON.parse(player.enchants || '{}');
      if ((enchants[data.stat] || 0) < 1) { callback({ success: false, error: `Aucun enchantement ${recipe.label} disponible` }); return; }

      // Applique sur l'item (empile).
      const eff = JSON.parse(item.effects || '{}');
      eff.__enchants = eff.__enchants || {};
      eff.__enchants[data.stat] = (eff.__enchants[data.stat] || 0) + 1;
      db.prepare('UPDATE inventory SET effects = ? WHERE id = ?').run(JSON.stringify(eff), item.id);

      // Décrémente le stock du joueur.
      enchants[data.stat] -= 1;
      db.prepare('UPDATE players SET enchants = ? WHERE id = ?').run(JSON.stringify(enchants), player.id);

      // Recalcule les stats si l'item est équipé.
      applyEquippedHeroStats(player.id);

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CRAFT : forger l'armure GOD (la plus puissante, créée) ----
  socket.on('craft_god_armor', (_data: any, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const GOD_GOLD = 100000;
      // Recette GOD : 1 objet de CHACUN des 40 boss de la Tour + 1 objet de
      // CHACUN des boss de campagne (chaque chapitre) + or.
      const GOD_ITEMS = [
        ...Array.from({ length: 40 }, (_, i) => ({ icon: `/items/boss_item_${String(i + 1).padStart(2, '0')}.png`, qty: 1 })),
        ...Array.from({ length: CAMPAIGN_CHAPTERS }, (_, i) => ({ icon: `/campaign_items/${i + 1}.png`, qty: 1 })),
      ];
      const resources = tickResources(village.id);
      if ((resources.gold || 0) < GOD_GOLD) { callback({ success: false, error: `Il faut ${GOD_GOLD.toLocaleString()} or` }); return; }
      const have = countItemsByIcon(player.id);
      for (const req of GOD_ITEMS) {
        if ((have[req.icon] || 0) < req.qty) { callback({ success: false, error: 'Il faut 1 objet de chaque boss (Tour 1-40 + chaque boss de campagne).' }); return; }
      }
      updateResources(village.id, resources.stone, resources.iron, resources.gold - GOD_GOLD, resources.food, resources.wood, resources.magic_energy);
      for (const req of GOD_ITEMS) consumeItemsByIcon(player.id, req.icon, req.qty);

      const god = generateGodArmor();
      db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, source) VALUES (?,?,?,?,?,?,?)')
        .run(genId(), player.id, god.itemType || 'armor_chest', god.name, god.rarity, JSON.stringify(god.effects), 'Craft — GOD');

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ============================================================
  // SET GOD — collection de 8 pièces. Chaque pièce coûte :
  //   • 100 000 000 d'or
  //   • 1 objet de CHACUN des 40 boss de la Tour
  //   • 1 objet de boss de campagne du chapitre 10 (le plus profond)
  // ============================================================
  const GOD_SET_GOLD = 100000000; // 100M par pièce
  const GOD_SET_TOWER_ITEMS = Array.from({ length: 40 }, (_, i) => ({ icon: `/items/boss_item_${String(i + 1).padStart(2, '0')}.png`, qty: 1 }));
  const GOD_SET_CAMPAIGN_ITEM = { icon: '/campaign_items/10.png', qty: 1 }; // chapitre 10+
  function godSetRequirements() {
    return { gold: GOD_SET_GOLD, towerItems: GOD_SET_TOWER_ITEMS, campaignItem: GOD_SET_CAMPAIGN_ITEM };
  }

  // ---- SET GOD : état de la collection (pièces possédées, coûts, possédé/craftable) ----
  socket.on('god_set_info', (_data: any, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const inv = getInventory(player.id);
      const owned: Record<string, boolean> = {};
      for (const it of inv) {
        try { const e = JSON.parse(it.effects || '{}'); if (e.__set === 'set_god' && e.__slot) owned[e.__slot] = true; } catch {}
      }
      const have = countItemsByIcon(player.id);
      const v = getVillageByPlayer(player.id);
      const res = v ? tickResources(v.id) : ({} as any);
      callback({
        success: true,
        slots: GOD_SET_SLOTS.map((slot: string) => ({ slot, name: ARMOR_SLOT_NAMES[slot as keyof typeof ARMOR_SLOT_NAMES], owned: !!owned[slot] })),
        ownedCount: Object.keys(owned).length,
        total: GOD_SET_SLOTS.length,
        gold: GOD_SET_GOLD,
        haveGold: Math.floor(res.gold || 0),
        towerItems: GOD_SET_TOWER_ITEMS.map((r) => ({ icon: r.icon, qty: r.qty, have: have[r.icon] || 0 })),
        campaignItem: { ...GOD_SET_CAMPAIGN_ITEM, have: have[GOD_SET_CAMPAIGN_ITEM.icon] || 0 },
      });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- SET GOD : forger une pièce d'un emplacement donné ----
  socket.on('craft_god_set_piece', (data: { slot: string }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }
      const slot = data?.slot;
      if (!GOD_SET_SLOTS.includes(slot as any)) { callback({ success: false, error: 'Emplacement invalide' }); return; }

      // Une seule pièce de chaque emplacement.
      const inv = getInventory(player.id);
      for (const it of inv) {
        try { const e = JSON.parse(it.effects || '{}'); if (e.__set === 'set_god' && e.__slot === slot) { callback({ success: false, error: 'Tu possèdes déjà cette pièce du Set GOD.' }); return; } } catch {}
      }

      const req = godSetRequirements();
      const resources = tickResources(village.id);
      if ((resources.gold || 0) < req.gold) { callback({ success: false, error: `Il faut ${req.gold.toLocaleString()} d'or` }); return; }
      const have = countItemsByIcon(player.id);
      for (const r of req.towerItems) {
        if ((have[r.icon] || 0) < r.qty) { callback({ success: false, error: 'Il faut 1 objet de CHACUN des 40 boss de la Tour.' }); return; }
      }
      if ((have[req.campaignItem.icon] || 0) < req.campaignItem.qty) {
        callback({ success: false, error: 'Il faut 1 objet de boss de campagne du chapitre 10.' }); return;
      }

      // Consomme or + items.
      updateResources(village.id, resources.stone, resources.iron, resources.gold - req.gold, resources.food, resources.wood, resources.magic_energy);
      for (const r of req.towerItems) consumeItemsByIcon(player.id, r.icon, r.qty);
      consumeItemsByIcon(player.id, req.campaignItem.icon, req.campaignItem.qty);

      const piece = generateGodSetPiece(slot as any);
      db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, source) VALUES (?,?,?,?,?,?,?)')
        .run(genId(), player.id, piece.itemType || `armor_${slot}`, piece.name, piece.rarity, JSON.stringify(piece.effects), 'Craft — Set GOD');

      callback({ success: true, slot, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('get_enchant_recipes', (_data: any, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      const activeBuffs = player ? getActiveBuffs(player.id) : {};
      callback({ success: true, recipes: ENCHANT_RECIPES, perLevel: ENCHANT_PER_LEVEL, potions: POTION_RECIPES, activeBuffs });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CRAFT : fabriquer et activer une potion (buff temporaire) ----
  socket.on('craft_potion', (data: { id: PotionId }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }

      const recipe = POTION_RECIPES[data?.id];
      if (!recipe) { callback({ success: false, error: 'Potion invalide' }); return; }

      const resources = tickResources(village.id);
      if ((resources.gold || 0) < recipe.gold) { callback({ success: false, error: `Il faut ${recipe.gold.toLocaleString()} or` }); return; }

      const have = countItemsByIcon(player.id);
      for (const req of recipe.items) {
        if ((have[req.icon] || 0) < req.qty) { callback({ success: false, error: 'Items de boss insuffisants' }); return; }
      }

      updateResources(village.id, resources.stone, resources.iron, resources.gold - recipe.gold, resources.food, resources.wood, resources.magic_energy);
      for (const req of recipe.items) consumeItemsByIcon(player.id, req.icon, req.qty);

      // Active le buff : si déjà actif, on prolonge la durée.
      const buffs = getActiveBuffs(player.id);
      const now = Math.floor(Date.now() / 1000);
      const base = (buffs[recipe.id] && buffs[recipe.id] > now) ? buffs[recipe.id] : now;
      buffs[recipe.id] = base + recipe.durationSec;
      db.prepare('UPDATE players SET active_buffs = ? WHERE id = ?').run(JSON.stringify(buffs), player.id);

      callback({ success: true, state: getFullVillageState(player.id), activeBuffs: buffs });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- DUELS 1v1 (mise de renommée) ----
  // Demande de duel : /duel <pseudo> <mise>. Vérifie que les deux joueurs
  // possèdent assez de renommée. Le gagnant remporte les 2 mises ; le perdant
  // perd sa mise. AUCUNE autre récompense (xp, item, ressource...).
  socket.on('duel_request', (data: { targetName: string; stake: number }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      if (blockIfAdmin(callback)) return;

      const stake = Math.floor(Number(data.stake || 0));
      if (!Number.isFinite(stake) || stake <= 0) { callback({ success: false, error: 'Mise invalide' }); return; }

      const targetName = String(data.targetName || '').trim();
      if (!targetName) { callback({ success: false, error: 'Pseudo manquant' }); return; }
      if (targetName.toLowerCase() === player.username.toLowerCase()) { callback({ success: false, error: 'Tu ne peux pas te défier toi-même' }); return; }

      const target = db.prepare('SELECT * FROM players WHERE LOWER(username) = LOWER(?)').get(targetName) as any;
      if (!target) { callback({ success: false, error: 'Joueur introuvable' }); return; }
      if (target.is_admin) { callback({ success: false, error: 'Duel impossible avec ce joueur' }); return; }

      if ((player.renown || 0) < stake) { callback({ success: false, error: `Tu n'as pas ${stake} renommée` }); return; }
      if ((target.renown || 0) < stake) { callback({ success: false, error: `${target.username} n'a pas ${stake} renommée` }); return; }
      if (!target.online || !target.socket_id) { callback({ success: false, error: `${target.username} n'est pas en ligne` }); return; }

      const duelId = genId();
      db.prepare('INSERT INTO duels (id, challenger_id, challenger_name, target_id, target_name, stake, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(duelId, player.id, player.username, target.id, target.username, stake, 'pending');

      io.to(target.socket_id).emit('duel_invite', { duelId, challenger: player.username, stake });
      callback({ success: true, duelId });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('duel_respond', (data: { duelId: string; accept: boolean }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const duel = db.prepare('SELECT * FROM duels WHERE id = ?').get(data.duelId) as any;
      if (!duel || duel.status !== 'pending') { callback({ success: false, error: 'Duel expiré' }); return; }
      if (duel.target_id !== player.id) { callback({ success: false, error: 'Duel non destiné à toi' }); return; }

      const challenger = db.prepare('SELECT * FROM players WHERE id = ?').get(duel.challenger_id) as any;
      const target = db.prepare('SELECT * FROM players WHERE id = ?').get(duel.target_id) as any;

      if (!data.accept) {
        db.prepare("UPDATE duels SET status = 'declined' WHERE id = ?").run(duel.id);
        if (challenger?.socket_id) io.to(challenger.socket_id).emit('duel_result', { declined: true, by: player.username });
        callback({ success: true, declined: true });
        return;
      }

      // Re-vérifie les renommées au moment d'accepter.
      const stake = duel.stake;
      if ((challenger?.renown || 0) < stake || (target?.renown || 0) < stake) {
        db.prepare("UPDATE duels SET status = 'cancelled' WHERE id = ?").run(duel.id);
        callback({ success: false, error: 'Renommée insuffisante pour un des joueurs' });
        if (challenger?.socket_id) io.to(challenger.socket_id).emit('duel_result', { cancelled: true });
        return;
      }

      // Puissance simple : héros + troupes (niveau appliqué), un peu d'aléatoire.
      const power = (pid: string): number => {
        const h = getHero(pid);
        // Duel = HÉROS uniquement. Les troupes ne comptent pas.
        const p = (h?.attack || 0) + (h?.defense || 0) + (h?.hp || 0) / 5 + (h?.magic || 0) * 2;
        return p * (0.85 + Math.random() * 0.3);
      };

      const pChallenger = power(challenger.id);
      const pTarget = power(target.id);
      const challengerWins = pChallenger >= pTarget;
      const winner = challengerWins ? challenger : target;
      const loser = challengerWins ? target : challenger;

      // Transfert de renommée : le gagnant prend la mise du perdant (les 2 mises
      // au total côté gagnant : il garde la sienne + gagne celle du perdant).
      db.prepare('UPDATE players SET renown = renown + ? WHERE id = ?').run(stake, winner.id);
      db.prepare('UPDATE players SET renown = MAX(0, renown - ?) WHERE id = ?').run(stake, loser.id);
      db.prepare("UPDATE duels SET status = 'done' WHERE id = ?").run(duel.id);

      const payload = { winner: winner.username, loser: loser.username, stake };
      if (challenger?.socket_id) io.to(challenger.socket_id).emit('duel_result', payload);
      if (target?.socket_id) io.to(target.socket_id).emit('duel_result', payload);

      // Annonce dans le tchat global.
      const msgId = genId();
      const text = `⚔️ Duel : ${winner.username} bat ${loser.username} et remporte ${stake} renommée !`;
      db.prepare('INSERT INTO chat_messages (id, player_id, username, message, channel) VALUES (?, ?, ?, ?, ?)')
        .run(msgId, winner.id, '⚔️ DUEL', text, 'global');
      io.emit('chat_message', { id: msgId, username: '⚔️ DUEL', message: text, channel: 'global', timestamp: Math.floor(Date.now() / 1000) });

      callback({ success: true, ...payload, youWon: winner.id === player.id, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('friend_add', (data: { username: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const friend = db.prepare('SELECT * FROM players WHERE username = ?').get(data.username) as any;
      if (!friend) { callback({ success: false, error: 'Joueur introuvable' }); return; }
      if (friend.id === player.id) { callback({ success: false, error: 'Impossible de s\'ajouter' }); return; }

      const existing = db.prepare('SELECT * FROM friends WHERE player_id = ? AND friend_id = ?').get(player.id, friend.id);
      if (existing) { callback({ success: false, error: 'Déjà ami' }); return; }

      db.prepare('INSERT INTO friends (id, player_id, friend_id, status) VALUES (?, ?, ?, ?)').run(genId(), player.id, friend.id, 'pending_sent');
      db.prepare('INSERT INTO friends (id, player_id, friend_id, status) VALUES (?, ?, ?, ?)').run(genId(), friend.id, player.id, 'pending');

      if (friend.online && friend.socket_id) {
        io.to(friend.socket_id).emit('friend_request', { playerId: player.id, username: player.username });
      }

      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- FRIENDS: Accept ----
  socket.on('friend_accept', (data: { friendId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback?.({ success: false, error: 'Non authentifié' }); return; }

      // On ne peut accepter qu'une demande reçue (status 'pending' de notre côté).
      const incoming = db.prepare("SELECT * FROM friends WHERE player_id = ? AND friend_id = ? AND status = 'pending'")
        .get(player.id, data.friendId) as any;
      if (!incoming) { callback?.({ success: false, error: 'Aucune demande à accepter' }); return; }

      db.prepare('UPDATE friends SET status = ? WHERE (player_id = ? AND friend_id = ?) OR (player_id = ? AND friend_id = ?)')
        .run('accepted', player.id, data.friendId, data.friendId, player.id);

      // Notifie le demandeur s'il est en ligne pour qu'il rafraîchisse sa liste.
      const requester = db.prepare('SELECT socket_id, online FROM players WHERE id = ?').get(data.friendId) as any;
      if (requester?.online && requester.socket_id) {
        io.to(requester.socket_id).emit('friend_accepted', { playerId: player.id, username: player.username });
      }

      callback?.({ success: true });
    } catch (err: any) { callback?.({ success: false, error: err.message }); }
  });

  // ---- FRIENDS: Remove / cancel ----
  socket.on('friend_remove', (data: { friendId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback?.({ success: false, error: 'Non authentifié' }); return; }

      db.prepare('DELETE FROM friends WHERE (player_id = ? AND friend_id = ?) OR (player_id = ? AND friend_id = ?)')
        .run(player.id, data.friendId, data.friendId, player.id);

      const other = db.prepare('SELECT socket_id, online FROM players WHERE id = ?').get(data.friendId) as any;
      if (other?.online && other.socket_id) {
        io.to(other.socket_id).emit('friend_removed', { playerId: player.id });
      }

      callback?.({ success: true });
    } catch (err: any) { callback?.({ success: false, error: err.message }); }
  });

  // ---- FRIENDS: List ----
  socket.on('friends_list', (_data, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const friends = db.prepare(`
        SELECT f.status, f.friend_id as id, p.username, p.online, p.renown
        FROM friends f
        JOIN players p ON f.friend_id = p.id
        WHERE f.player_id = ?
      `).all(player.id);

      callback({ success: true, friends });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CHAT: Message ----
  socket.on('chat_message', (data: { message: string; channel?: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const channel = data.channel || 'global';
      const msgId = genId();

      db.prepare('INSERT INTO chat_messages (id, player_id, username, message, channel) VALUES (?, ?, ?, ?, ?)')
        .run(msgId, player.id, player.username, data.message, channel);

      io.emit('chat_message', {
        id: msgId, username: player.username, message: data.message, channel,
        timestamp: Math.floor(Date.now() / 1000)
      });

      callback({ success: true });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CHAT: History ----
  socket.on('chat_history', (data: { channel?: string; limit?: number }, callback) => {
    try {
      const channel = data.channel || 'global';
      const limit = Math.min(data.limit || 50, 100);
      const messages = db.prepare('SELECT * FROM chat_messages WHERE channel = ? ORDER BY timestamp DESC LIMIT ?').all(channel, limit);
      callback({ success: true, messages: (messages as any[]).reverse() });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- LEADERBOARD ----
  socket.on('leaderboard', (_data, callback) => {
    try {
      const leaders = db.prepare('SELECT id, username, renown, prestige_count FROM players WHERE is_admin = 0 ORDER BY renown DESC LIMIT 50').all();
      const towerLeaders = db.prepare(`
        SELECT p.id, p.username, t.best_floor
        FROM tower_progress t
        JOIN players p ON p.id = t.player_id
        WHERE t.best_floor > 0 AND p.is_admin = 0
        ORDER BY t.best_floor DESC
        LIMIT 50
      `).all();
      // Classement par OR total (or stocké dans le village du joueur).
      const goldLeaders = db.prepare(`
        SELECT p.id, p.username, CAST(r.gold AS INTEGER) AS gold
        FROM resources r
        JOIN villages v ON v.id = r.village_id
        JOIN players p ON p.id = v.player_id
        WHERE p.is_admin = 0
        ORDER BY r.gold DESC
        LIMIT 50
      `).all();
      callback({ success: true, leaderboard: leaders, towerLeaderboard: towerLeaders, goldLeaderboard: goldLeaders, weekNumber: Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PRESTIGE ----
  socket.on('prestige', (_data, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      if (!village) { callback({ success: false, error: 'Village introuvable' }); return; }
      const requiredThLevel = 5 + player.prestige_count;
      if (village.town_hall_level < requiredThLevel) { callback({ success: false, error: `HdV niveau ${requiredThLevel} minimum` }); return; }

      const newPrestigeCount = player.prestige_count + 1;
      const bonuses = getPrestigeBonuses(newPrestigeCount);

      db.prepare('UPDATE players SET prestige_count = ?, prestige_bonuses = ? WHERE id = ?')
        .run(newPrestigeCount, JSON.stringify(bonuses), player.id);

      db.prepare('UPDATE villages SET tier = 1, town_hall_level = 1 WHERE id = ?').run(village.id);

      const sr = bonuses.startingResources;
      // Le prestige NE remet PAS l'or à 0 : on conserve l'or actuel du joueur.
      const currentResources = tickResources(village.id);
      const keptGold = Math.max(sr.gold, Math.floor(currentResources.gold || 0));
      db.prepare('UPDATE resources SET stone = ?, iron = ?, gold = ?, food = ?, wood = ?, magic_energy = ?, last_update = strftime("%s","now") WHERE village_id = ?')
        .run(sr.stone, sr.iron, keptGold, sr.food, sr.wood, sr.magic_energy, village.id);

      db.prepare('DELETE FROM buildings WHERE village_id = ?').run(village.id);
      const buildingTypes: BuildingType[] = ['town_hall', 'mine', 'lumberjack', 'farm', 'farm'];
      for (const type of buildingTypes) {
        const maxW = getMaxWorkers(type, 1);
        db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, ?, ?)')
          .run(genId(), village.id, type, type === 'town_hall' ? 0 : 2, maxW);
      }

      db.prepare('DELETE FROM troops WHERE village_id = ?').run(village.id);
      db.prepare('INSERT INTO troops (id, village_id, type, count, level) VALUES (?, ?, ?, 5, 1)').run(genId(), village.id, 'soldier');

      // Réinitialise le héros au niveau 1. Les stats stockées = base + équipements
      // (le bonus de prestige heroBonus est appliqué EN COMBAT, comme partout
      // ailleurs dans le code, pas stocké en base).
      const baseStats = heroStatsForLevel(1);
      db.prepare('UPDATE heroes SET level = 1, xp = 0, skill_points = 0, attack = ?, defense = ?, hp = ?, magic = ? WHERE player_id = ?')
        .run(baseStats.attack, baseStats.defense, baseStats.hp, baseStats.magic, player.id);
      // Réapplique immédiatement les bonus des équipements ÉQUIPÉS (qui restent
      // équipés après un prestige) pour que les stats soient correctes tout de
      // suite, sans avoir à gagner un combat d'abord.
      applyEquippedHeroStats(player.id);

      db.prepare('UPDATE campaign_progress SET chapter = 1, episode = 1 WHERE player_id = ?').run(player.id);
      // Prestige : tous les étages de la tour sont remis à 0 (tous les multiplicateurs).
      // Prestige : on remet à zéro la PROGRESSION de la tour (étage courant +
      // étages par multiplicateur), MAIS on conserve le record best_floor qui est
      // indépendant du prestige et reste affiché dans le classement.
      db.prepare("UPDATE tower_progress SET current_floor = 0, floors_by_mult = '{}' WHERE player_id = ?").run(player.id);

      callback({ success: true, state: getFullVillageState(player.id), prestigeCount: newPrestigeCount, bonuses });
      socket.emit('notification', { type: 'prestige', message: `Prestige ${newPrestigeCount} ! +${Math.round(bonuses.productionMultiplier * 100 - 100)}% production` });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PVP RAID ----
  socket.on('pvp_raid', (data: { targetId: string; troops: Record<string, number> }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const target = db.prepare('SELECT * FROM players WHERE id = ?').get(data.targetId) as any;
      if (!target) { callback({ success: false, error: 'Cible introuvable' }); return; }

      const village = getVillageByPlayer(player.id);
      const targetVillage = getVillageByPlayer(target.id);

      const resources = tickResources(village.id);
      for (const res of RESOURCES) {
        if ((resources[res] || 0) < RAID_COST[res]) {
          callback({ success: false, error: 'Ressources insuffisantes' }); return;
        }
      }

      const nr: Record<string, number> = {};
      for (const res of RESOURCES) nr[res] = (resources[res] || 0) - RAID_COST[res];
      updateResources(village.id, nr.stone, nr.iron, nr.gold, nr.food, nr.wood, nr.magic_energy);

      const hero = getHero(player.id);
      const targetHero = getHero(target.id);
      const targetTroops = getTroops(targetVillage.id);

      const enemyTroops = targetTroops.map((t: any) => ({
        type: t.type as TroopType,
        count: Math.floor(t.count * (1 + RAID_DEFENSE_BONUS))
      }));

      const result = resolveCombat(
        data.troops,
        { attack: hero.attack, defense: hero.defense, hp: hero.hp, magic: hero.magic, level: hero.level },
        enemyTroops,
        { level: targetHero.level, attack: targetHero.attack * (1 + RAID_DEFENSE_BONUS), defense: targetHero.defense * (1 + RAID_DEFENSE_BONUS), hp: targetHero.hp * (1 + RAID_DEFENSE_BONUS) },
        { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 0 },
        0,
        village.tier * 10
      );

      const stolenResources: Record<string, number> = {};
      if (result.victory) {
        const targetResources = tickResources(targetVillage.id);
        const stealRate = 0.15 + village.tier * 0.02;
        for (const res of RESOURCES) {
          const stolen = Math.floor((targetResources[res] || 0) * stealRate);
          stolenResources[res] = stolen;
          db.prepare(`UPDATE resources SET ${res} = ${res} - ? WHERE village_id = ?`).run(stolen, targetVillage.id);
        }
        const attackerRes = tickResources(village.id);
        const caps = getResourceCaps(village.tier, village.town_hall_level || 1);
        const ur: Record<string, number> = {};
        for (const res of RESOURCES) ur[res] = Math.min(caps[res], (attackerRes[res] || 0) + stolenResources[res]);
        updateResources(village.id, ur.stone, ur.iron, ur.gold, ur.food, ur.wood, ur.magic_energy);
      }

      for (const [type, count] of Object.entries(result.survivingTroops)) {
        db.prepare('UPDATE troops SET count = ? WHERE village_id = ? AND type = ?').run(count, village.id, type);
      }

      db.prepare('INSERT INTO raids (id, attacker_id, defender_id, result, resources_stolen) VALUES (?, ?, ?, ?, ?)')
        .run(genId(), player.id, target.id, result.victory ? 'victory' : 'defeat', JSON.stringify(stolenResources));

      if (target.online && target.socket_id) {
        io.to(target.socket_id).emit('notification', {
          type: 'raid_received',
          message: result.victory
            ? `${player.username} a pillé votre village !`
            : `${player.username} a été repoussé !`
        });
      }

      callback({ success: true, result, stolenResources, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- MARKET: Fixed resource prices ----
  socket.on('market_sell_info', (_data, callback) => {
    try {
      const activeMarketEvent = getActiveMarketSellEvent();
      callback({
        success: true,
        prices: RESOURCE_SELL_PRICES,
        multiplier: activeMarketEvent.multiplier || 1,
        eventName: activeMarketEvent.name,
      });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- MARKET: Sell ----
  socket.on('market_sell', (data: { resourceType?: ResourceType; amount?: number; pricePerUnit: number; listingType?: 'resource' | 'equipment' | 'item'; itemId?: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      const listingType = data.listingType || 'resource';

      // ---- Vente d'OBJETS de boss (butin) : quantité libre, aucune limite ----
      if (listingType === 'item') {
        const price = Number((data as any).pricePerUnit || 0);
        const qty = Math.floor(Number((data as any).amount || 0));
        if (!Number.isFinite(price) || price <= 0) { callback({ success: false, error: 'Prix invalide' }); return; }
        if (!Number.isFinite(qty) || qty <= 0) { callback({ success: false, error: 'Quantité invalide' }); return; }
        if (!data.itemId) { callback({ success: false, error: 'Objet manquant' }); return; }

        const ref = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.itemId, player.id) as any;
        if (!ref) { callback({ success: false, error: 'Objet introuvable' }); return; }

        // Tous les exemplaires identiques (même nom + mêmes effets, non équipés).
        const copies = db.prepare('SELECT id FROM inventory WHERE player_id = ? AND name = ? AND effects = ? AND (equipped IS NULL OR equipped = 0)')
          .all(player.id, ref.name, ref.effects || '{}') as any[];
        if (copies.length < qty) { callback({ success: false, error: `Tu n'as que ${copies.length} exemplaire(s).` }); return; }

        db.prepare(`
          INSERT INTO market_listings (
            id, player_id, resource_type, amount, price_per_unit, listing_type, item_id, item_type, item_name, item_rarity, item_effects, item_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          genId(), player.id, 'item', qty, price, 'item', ref.id, ref.item_type || 'item', ref.name,
          ref.rarity || 'common', ref.effects || '{}', ref.source || 'butin'
        );

        for (let i = 0; i < qty; i++) db.prepare('DELETE FROM inventory WHERE id = ?').run(copies[i].id);

        callback({ success: true, state: getFullVillageState(player.id) });
        return;
      }

      if (listingType === 'equipment') {
        const price = Number(data.pricePerUnit || 0);
        if (!Number.isFinite(price) || price <= 0) { callback({ success: false, error: 'Prix invalide' }); return; }
        if (!data.itemId) { callback({ success: false, error: 'Équipement manquant' }); return; }
        const item = db.prepare('SELECT * FROM inventory WHERE id = ? AND player_id = ?').get(data.itemId, player.id) as any;
        if (!item) { callback({ success: false, error: 'Équipement introuvable' }); return; }

        // Les objets de boss (icône boss_item_ / campaign_items) sont vendables
        // SANS limite. Les autres équipements sont plafonnés à 10 annonces.
        let isBossLoot = false;
        try {
          const eff = JSON.parse(item.effects || '{}');
          const ic = String(eff.__icon || '');
          isBossLoot = item.item_type === 'item' || ic.includes('boss_item_') || ic.includes('campaign_items');
        } catch {}

        if (!isBossLoot) {
          const activeEquip = db.prepare(`
            SELECT COUNT(*) AS n FROM market_listings
            WHERE player_id = ? AND listing_type = 'equipment'
              AND (item_type IS NULL OR (item_type NOT LIKE '%item%'))
              AND (item_effects IS NULL OR (item_effects NOT LIKE '%boss_item_%' AND item_effects NOT LIKE '%campaign_items%'))
          `).get(player.id) as any;
          if ((activeEquip?.n || 0) >= 10) {
            callback({ success: false, error: 'Limite de 10 équipements en vente atteinte.' }); return;
          }
        }

        db.prepare(`
          INSERT INTO market_listings (
            id, player_id, resource_type, amount, price_per_unit, listing_type, item_id, item_type, item_name, item_rarity, item_effects, item_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          genId(), player.id, 'equipment', 1, price, 'equipment', item.id, item.item_type, item.name,
          item.rarity, item.effects || '{}', item.source || 'marché'
        );

        db.prepare('DELETE FROM inventory WHERE id = ? AND player_id = ?').run(item.id, player.id);
        if (item.equipped) applyEquippedHeroStats(player.id);

        callback({ success: true, state: getFullVillageState(player.id) });
        return;
      }

      const amount = Math.floor(Number(data.amount || 0));
      if (!data.resourceType || !RESOURCES.includes(data.resourceType) || amount <= 0) {
        callback({ success: false, error: 'Vente invalide' }); return;
      }
      if (data.resourceType === 'gold') {
        callback({ success: false, error: 'Tu ne peux pas vendre de l’or contre de l’or.' }); return;
      }

      const fixedPrice = RESOURCE_SELL_PRICES[data.resourceType] || 0;
      if (fixedPrice <= 0) {
        callback({ success: false, error: 'Cette ressource ne peut pas être vendue.' }); return;
      }

      const resources = tickResources(village.id);
      if ((resources[data.resourceType] || 0) < amount) {
        callback({ success: false, error: 'Ressources insuffisantes' }); return;
      }

      const activeMarketEvent = getActiveMarketSellEvent();
      const multiplier = activeMarketEvent.multiplier || 1;
      const goldEarned = Math.floor(amount * fixedPrice * multiplier);

      db.prepare(`UPDATE resources SET ${data.resourceType} = ${data.resourceType} - ?, gold = gold + ? WHERE village_id = ?`)
        .run(amount, goldEarned, village.id);

      callback({
        success: true,
        state: getFullVillageState(player.id),
        goldEarned,
        pricePerUnit: fixedPrice,
        multiplier,
        eventName: activeMarketEvent.name,
      });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- MARKET: Buy ----
  socket.on('market_buy', (data: { listingId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const listing = db.prepare('SELECT * FROM market_listings WHERE id = ?').get(data.listingId) as any;
      if (!listing) { callback({ success: false, error: 'Offre introuvable' }); return; }
      if (listing.player_id === player.id) { callback({ success: false, error: 'Achat impossible' }); return; }

      const totalPrice = Number(listing.amount || 1) * Number(listing.price_per_unit || 0);
      const village = getVillageByPlayer(player.id);
      const resources = tickResources(village.id);

      if ((resources.gold || 0) < totalPrice) { callback({ success: false, error: 'Or insuffisant' }); return; }

      if ((listing.listing_type || 'resource') === 'item') {
        // Achat d'objets de boss : ajoute `amount` exemplaires à l'inventaire.
        db.prepare('UPDATE resources SET gold = gold - ? WHERE village_id = ?').run(totalPrice, village.id);
        const qty = Math.max(1, Math.floor(Number(listing.amount || 1)));
        for (let i = 0; i < qty; i++) {
          db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, equipped, source) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
            .run(genId(), player.id, listing.item_type || 'item', listing.item_name || 'Objet du marché', listing.item_rarity || 'common', listing.item_effects || '{}', `Marché - ${listing.username || 'joueur'}`);
        }
      } else if ((listing.listing_type || 'resource') === 'equipment') {
        db.prepare('UPDATE resources SET gold = gold - ? WHERE village_id = ?')
          .run(totalPrice, village.id);

        db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, equipped, source) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
          .run(genId(), player.id, listing.item_type || 'armor', listing.item_name || 'Équipement du marché', listing.item_rarity || 'common', listing.item_effects || '{}', `Marché - ${listing.username || 'joueur'}`);
      } else {
        if (!RESOURCES.includes(listing.resource_type)) { callback({ success: false, error: 'Offre invalide' }); return; }
        db.prepare(`UPDATE resources SET gold = gold - ?, ${listing.resource_type} = ${listing.resource_type} + ? WHERE village_id = ?`)
          .run(totalPrice, listing.amount, village.id);
      }

      const sellerVillage = getVillageByPlayer(listing.player_id);
      const fee = totalPrice * MARKET_FEE;
      db.prepare('UPDATE resources SET gold = gold + ? WHERE village_id = ?')
        .run(totalPrice - fee, sellerVillage.id);

      db.prepare('DELETE FROM market_listings WHERE id = ?').run(data.listingId);

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- MARKET: Cancel (retirer sa propre offre, remise en inventaire) ----
  socket.on('market_cancel', (data: { listingId: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const listing = db.prepare('SELECT * FROM market_listings WHERE id = ?').get(data.listingId) as any;
      if (!listing) { callback({ success: false, error: 'Offre introuvable' }); return; }
      if (listing.player_id !== player.id) { callback({ success: false, error: 'Ce n\'est pas ton offre' }); return; }

      const type = listing.listing_type || 'resource';
      if (type === 'equipment') {
        // Un seul exemplaire remis.
        db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, equipped, source) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
          .run(genId(), player.id, listing.item_type || 'armor', listing.item_name || 'Équipement', listing.item_rarity || 'common', listing.item_effects || '{}', listing.item_source || 'marché');
      } else if (type === 'item') {
        // Remet `amount` exemplaires.
        const qty = Math.max(1, Math.floor(Number(listing.amount || 1)));
        for (let i = 0; i < qty; i++) {
          db.prepare('INSERT INTO inventory (id, player_id, item_type, name, rarity, effects, equipped, source) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
            .run(genId(), player.id, listing.item_type || 'item', listing.item_name || 'Objet', listing.item_rarity || 'common', listing.item_effects || '{}', listing.item_source || 'butin');
        }
      } else {
        // Ressource : recrédite la quantité.
        const village = getVillageByPlayer(player.id);
        if (village && RESOURCES.includes(listing.resource_type)) {
          db.prepare(`UPDATE resources SET ${listing.resource_type} = ${listing.resource_type} + ? WHERE village_id = ?`).run(listing.amount, village.id);
        }
      }

      db.prepare('DELETE FROM market_listings WHERE id = ?').run(data.listingId);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- MARKET: Listings ----
  socket.on('market_listings', (data: { resourceType?: ResourceType; listingType?: 'resource' | 'equipment' | 'item' }, callback) => {
    try {
      let listings;
      if (data.listingType === 'item') {
        listings = db.prepare(`
          SELECT m.*, p.username FROM market_listings m
          JOIN players p ON m.player_id = p.id
          WHERE m.listing_type = 'item'
          ORDER BY m.created_at DESC LIMIT 50
        `).all();
      } else if (data.listingType === 'equipment') {
        listings = db.prepare(`
          SELECT m.*, p.username FROM market_listings m
          JOIN players p ON m.player_id = p.id
          WHERE m.listing_type = 'equipment'
          ORDER BY m.created_at DESC LIMIT 50
        `).all();
      } else if (data.resourceType) {
        listings = db.prepare(`
          SELECT m.*, p.username FROM market_listings m
          JOIN players p ON m.player_id = p.id
          WHERE (m.listing_type IS NULL OR m.listing_type = 'resource') AND m.resource_type = ?
          ORDER BY m.price_per_unit ASC LIMIT 50
        `).all(data.resourceType);
      } else {
        listings = db.prepare('SELECT m.*, p.username FROM market_listings m JOIN players p ON m.player_id = p.id ORDER BY m.created_at DESC LIMIT 50').all();
      }
      callback({ success: true, listings });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- RESEARCH: Start ----
  socket.on('start_research', (data: { type: string }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }

      const village = getVillageByPlayer(player.id);
      const researchConfig = RESEARCH_TYPES.find(r => r.id === data.type);
      if (!researchConfig) { callback({ success: false, error: 'Recherche introuvable' }); return; }

      const existing = db.prepare('SELECT * FROM research WHERE village_id = ? AND type = ?').get(village.id, data.type) as any;
      if (existing && existing.completion_time > Math.floor(Date.now() / 1000)) {
        callback({ success: false, error: 'Déjà en cours' }); return;
      }

      const currentLevel = existing ? existing.level : 0;
      if (currentLevel >= researchConfig.maxLevel) { callback({ success: false, error: 'Niveau max atteint' }); return; }

      const cost: Record<string, number> = {};
      for (const res of RESOURCES) cost[res] = Math.floor(researchConfig.baseCost[res] * Math.pow(researchConfig.costMultiplier, currentLevel));

      const resources = tickResources(village.id);
      for (const res of RESOURCES) {
        if ((resources[res] || 0) < cost[res]) {
          callback({ success: false, error: `Ressources insuffisantes: ${res}` }); return;
        }
      }

      const nr: Record<string, number> = {};
      for (const res of RESOURCES) nr[res] = (resources[res] || 0) - cost[res];
      updateResources(village.id, nr.stone, nr.iron, nr.gold, nr.food, nr.wood, nr.magic_energy);

      const now = Math.floor(Date.now() / 1000);
      const completionTime = now + Math.floor(researchConfig.baseTime * Math.pow(1.3, currentLevel));

      if (existing) {
        db.prepare('UPDATE research SET level = level + 1, start_time = ?, completion_time = ? WHERE id = ?').run(now, completionTime, existing.id);
      } else {
        db.prepare('INSERT INTO research (id, village_id, type, level, start_time, completion_time) VALUES (?, ?, ?, 1, ?, ?)')
          .run(genId(), village.id, data.type, now, completionTime);
      }

      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- SEASONAL EVENTS ----
  // ---- BOSS DU JOUR : un boss tiré chaque jour (déterministe via la date).
  // Il lâche son objet signature à 100%, +renommée x5, +ressources x3.
  // ============================================================
  // DONJONS — combats en chaîne (5 manches : 4 monstres + 1 boss très dur).
  // Nécessite 1 clé. Récompense finale : 100 000 renommée.
  // Une clé par jour par joueur, obtenue en battant 5–10 boss tirés au hasard
  // par un PNJ du Marché et en lui rendant leurs objets.
  // ============================================================
  const DUNGEON_ROUNDS = 5;          // 4 monstres + 1 boss
  const DUNGEON_RENOWN = 100000;     // récompense finale
  function todayNum() { return localDayNum(); }

  // Génère (ou relit) la quête de clé du jour : 5 à 10 boss aléatoires + items à rendre.
  function getOrCreateKeyQuest(player: any) {
    const today = todayNum();
    if (player.key_quest_day === today && player.key_quest) {
      try { return JSON.parse(player.key_quest); } catch { /* regénère */ }
    }
    const n = 5 + Math.floor(Math.random() * 6); // 5..10
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const bosses = pool.slice(0, n).sort((a, b) => a - b);
    const quest = {
      bosses,
      items: bosses.map((b) => ({ icon: `/items/boss_item_${String(b).padStart(2, '0')}.png`, qty: 1, boss: b })),
    };
    db.prepare('UPDATE players SET key_quest = ?, key_quest_day = ? WHERE id = ?').run(JSON.stringify(quest), today, player.id);
    return quest;
  }

  // ---- CLÉ : état de la quête + clés possédées ----
  socket.on('key_quest_info', (_data, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      const quest = getOrCreateKeyQuest(fresh);
      const have = countItemsByIcon(player.id);
      const today = todayNum();
      callback({
        success: true,
        keys: fresh.dungeon_keys || 0,
        claimedToday: fresh.key_claim_day === today,
        items: quest.items.map((it: any) => ({ ...it, have: have[it.icon] || 0, name: BOSS_NAMES[it.boss - 1] || `Boss ${it.boss}` })),
        complete: quest.items.every((it: any) => (have[it.icon] || 0) >= it.qty),
      });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- CLÉ : échanger les items contre la clé (1 par jour) ----
  socket.on('key_claim', (_data, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      const today = todayNum();
      if (fresh.key_claim_day === today) { callback({ success: false, error: 'Tu as déjà récupéré ta clé aujourd\'hui. Reviens demain.' }); return; }
      const quest = getOrCreateKeyQuest(fresh);
      const have = countItemsByIcon(player.id);
      for (const it of quest.items) {
        if ((have[it.icon] || 0) < it.qty) { callback({ success: false, error: 'Il te manque des objets de boss demandés par le PNJ.' }); return; }
      }
      for (const it of quest.items) consumeItemsByIcon(player.id, it.icon, it.qty);
      db.prepare('UPDATE players SET dungeon_keys = dungeon_keys + 1, key_claim_day = ? WHERE id = ?').run(today, player.id);
      callback({ success: true, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- DONJON : info (clés, manche en cours) ----
  socket.on('dungeon_info', (_data, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      let run: any = null;
      try { run = fresh.dungeon_run ? JSON.parse(fresh.dungeon_run) : null; } catch { run = null; }
      callback({ success: true, keys: fresh.dungeon_keys || 0, rounds: DUNGEON_ROUNDS, renown: DUNGEON_RENOWN, run });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // Construit les ennemis d'une manche de donjon. Manches 1-4 : monstres très
  // costauds. Manche 5 : boss colossal. Calibré pour être quasi impossible en
  // solo avec du mythique, faisable (mais dur) avec un set suprême complet.
  function dungeonEnemiesForRound(round: number, tier: number) {
    if (round >= DUNGEON_ROUNDS) {
      // Boss final colossal : boss élevé avec énorme multiplicateur.
      const idx = 35 + Math.floor(Math.random() * 6); // boss 35..40
      const boss = generateBoss(idx, 1, 18);
      return { enemyTroops: boss.enemyTroops, enemyHero: boss.enemyHero, label: `Donjon — BOSS : ${boss.bossName}`, bossIndex: idx, isBoss: true };
    }
    // Monstres : étages de tour très élevés avec gros multiplicateur, montant par manche.
    const floor = 80 + tier * 6 + round * 12;
    const lvl = generateTowerFloor(floor, 8 + round);
    return { enemyTroops: lvl.enemyTroops, enemyHero: lvl.enemyHero, label: `Donjon — Manche ${round}/4`, bossIndex: null, isBoss: false };
  }

  // ---- DONJON : démarrer une descente (consomme 1 clé) ----
  socket.on('dungeon_start', (_data, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      if ((fresh.dungeon_keys || 0) <= 0) { callback({ success: false, error: 'Il te faut une clé de donjon.' }); return; }
      db.prepare('UPDATE players SET dungeon_keys = dungeon_keys - 1, dungeon_run = ? WHERE id = ?')
        .run(JSON.stringify({ round: 1, startedAt: Date.now() }), player.id);
      callback({ success: true, round: 1, rounds: DUNGEON_ROUNDS, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- DONJON : préparer le combat de la manche courante ----
  socket.on('dungeon_setup', (data: { troops: Record<string, number> }, callback) => {
    try {
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      let run: any = null; try { run = JSON.parse(fresh.dungeon_run || ''); } catch {}
      if (!run) { callback({ success: false, error: 'Aucune descente en cours.' }); return; }
      const village = getVillageByPlayer(player.id);
      const hero = getHero(player.id);
      const pb = getPrestigeBonuses(fresh.prestige_count);
      const en = dungeonEnemiesForRound(run.round, village?.tier || 1);
      const heroStats = {
        name: hero.name, level: hero.level,
        attack: Math.round(hero.attack * (1 + pb.heroBonus)),
        defense: Math.round(hero.defense * (1 + pb.heroBonus)),
        hp: Math.round(hero.hp * (1 + pb.heroBonus)),
        magic: Math.round(hero.magic * (1 + pb.heroBonus)),
        critChance: totalCritChance(player.id, hero.crit_level || 0),
        critMult: critMultForPlayer(player.id),
      };
      const skillLevels = JSON.parse(hero.skills || '{}');
      const villageTroops = village ? getTroops(village.id) : [];
      const troops = Object.entries(data.troops || {}).map(([type, count]) => {
        const t = villageTroops.find((x: any) => x.type === type);
        return { type, count: count as number, level: t?.level || 1 };
      });
      callback({ success: true, setup: { heroStats, skillLevels, troops, enemyTroops: en.enemyTroops, enemyHero: en.enemyHero, label: en.label, bossIndex: en.bossIndex, isBoss: en.isBoss }, round: run.round, rounds: DUNGEON_ROUNDS });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- DONJON : résoudre la manche courante et enchaîner ----
  socket.on('dungeon_battle', (data: { troops: Record<string, number>; clientResult?: { victory: boolean; survivingTroops?: Record<string, number> } }, callback) => {
    try {
      if (blockIfAdmin(callback)) return;
      const player = getPlayerBySocket(socket.id);
      if (!player) { callback({ success: false, error: 'Non authentifié' }); return; }
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id) as any;
      let run: any = null; try { run = JSON.parse(fresh.dungeon_run || ''); } catch {}
      if (!run) { callback({ success: false, error: 'Aucune descente en cours.' }); return; }
      const village = getVillageByPlayer(player.id);
      const hero = getHero(player.id);
      const pb = getPrestigeBonuses(fresh.prestige_count);
      const en = dungeonEnemiesForRound(run.round, village?.tier || 1);
      const troopLevels: Record<string, number> = {};
      (village ? getTroops(village.id) : []).forEach((t: any) => { troopLevels[t.type] = t.level || 1; });

      const isFinal = run.round >= DUNGEON_ROUNDS;
      // Récompense : uniquement à la dernière manche (100k renommée). Manches
      // intermédiaires : pas de butin (l'enjeu est d'aller au bout).
      const renownReward = isFinal ? DUNGEON_RENOWN : 0;
      const result = resolveCombat(
        data.troops,
        { attack: hero.attack * (1 + pb.heroBonus), defense: hero.defense * (1 + pb.heroBonus), hp: hero.hp, magic: hero.magic, level: hero.level },
        en.enemyTroops, en.enemyHero, {} as any, renownReward, run.round, 'boss', 1, troopLevels, data.clientResult || null, null
      );

      // Pertes de troupes appliquées à chaque manche.
      applyOutcomeToPlayer(player.id, data.troops, result.survivingTroops, result);

      if (!result.victory) {
        // Échec : la descente s'arrête, la clé est perdue.
        db.prepare('UPDATE players SET dungeon_run = ? WHERE id = ?').run('', player.id);
        callback({ success: true, result, failed: true, round: run.round, rounds: DUNGEON_ROUNDS, bossName: en.isBoss ? en.label : undefined, bossIndex: en.bossIndex, state: getFullVillageState(player.id) });
        return;
      }

      if (isFinal) {
        // Donjon terminé : la renommée a été accordée par applyOutcomeToPlayer.
        db.prepare('UPDATE players SET dungeon_run = ? WHERE id = ?').run('', player.id);
        callback({ success: true, result, completed: true, round: run.round, rounds: DUNGEON_ROUNDS, bossName: en.label, bossIndex: en.bossIndex, state: getFullVillageState(player.id) });
        return;
      }

      // Manche réussie : passer à la suivante.
      run.round += 1;
      db.prepare('UPDATE players SET dungeon_run = ? WHERE id = ?').run(JSON.stringify(run), player.id);
      callback({ success: true, result, nextRound: run.round, rounds: DUNGEON_ROUNDS, bossIndex: en.bossIndex, state: getFullVillageState(player.id) });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('daily_boss', (_data, callback) => {
    try {
      const info = getDailyBoss();
      callback({ success: true, ...info });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  socket.on('seasonal_events', (_data, callback) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const events = db.prepare('SELECT * FROM seasonal_events WHERE end_date > ? ORDER BY start_date ASC').all(now);
      callback({ success: true, events });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- PLAYER INFO ----
  socket.on('get_player_info', (data: { playerId: string }, callback) => {
    try {
      const target = db.prepare('SELECT id, username, renown, prestige_count, online FROM players WHERE id = ?').get(data.playerId) as any;
      if (!target) { callback({ success: false, error: 'Joueur introuvable' }); return; }

      const village = getVillageByPlayer(target.id);
      const troops = getTroops(village.id);
      const hero = getHero(target.id);

      callback({
        success: true,
        info: { player: target, village: { tier: village.tier, town_hall_level: village.town_hall_level }, troopCount: troops.reduce((s: number, t: any) => s + t.count, 0), heroLevel: hero?.level || 1 }
      });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- ONLINE PLAYERS ----
  socket.on('online_players', (_data, callback) => {
    try {
      const players = db.prepare('SELECT id, username, renown, online FROM players WHERE is_admin = 0 ORDER BY renown DESC LIMIT 50').all();
      callback({ success: true, players });
    } catch (err: any) { callback({ success: false, error: err.message }); }
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', () => {
    const player = getPlayerBySocket(socket.id);
    if (player) {
      db.prepare('UPDATE players SET online = 0, socket_id = NULL WHERE id = ?').run(player.id);
      const friends = db.prepare('SELECT friend_id FROM friends WHERE player_id = ? AND status = ?').all(player.id, 'accepted') as any[];
      for (const f of friends) {
        const friend = db.prepare('SELECT socket_id FROM players WHERE id = ? AND online = 1').get(f.friend_id) as any;
        if (friend?.socket_id) {
          io.to(friend.socket_id).emit('friend_offline', { playerId: player.id, username: player.username });
        }
      }
    }
    console.log(`[Game] Disconnected: ${socket.id}`);
  });
});

// =============================================
// REST ENDPOINTS
// =============================================

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Seed seasonal events
const eventCount = (db.prepare('SELECT COUNT(*) as count FROM seasonal_events').get() as any).count;
if (eventCount === 0) {
  const now = Math.floor(Date.now() / 1000);
  const twoWeeks = 14 * 24 * 60 * 60;
  const events = [
    { name: 'Folie des ressources', desc: 'Production doublee pendant evenement!', rewards: JSON.stringify({ stone: 5000, iron: 3000, gold: 2000 }) },
    { name: 'Foire marchande', desc: 'Les ventes automatiques de ressources au marche rapportent x1,5 or!', rewards: JSON.stringify({ marketSellMultiplier: 1.5 }) },
    { name: 'Invasion de dragons', desc: 'Combattez des dragons pour des recompenses!', rewards: JSON.stringify({ renown: 500 }) },
    { name: 'Tournoi des champions', desc: 'Competition PvP pour la gloire!', rewards: JSON.stringify({ renown: 1000, gold: 10000 }) },
  ];
  for (let i = 0; i < events.length; i++) {
    db.prepare('INSERT INTO seasonal_events (id, name, description, start_date, end_date, rewards) VALUES (?, ?, ?, ?, ?, ?)')
      .run(genId(), events[i].name, events[i].desc, now + i * twoWeeks, now + (i + 1) * twoWeeks, events[i].rewards);
  }
  console.log('[Game] Seeded seasonal events');
}

// Ajoute l'événement marchand aux anciennes bases sans supprimer les événements existants.
const marketEventCount = (db.prepare('SELECT COUNT(*) as count FROM seasonal_events WHERE name = ?').get('Foire marchande') as any).count;
if (marketEventCount === 0) {
  const now = Math.floor(Date.now() / 1000);
  const twoWeeks = 14 * 24 * 60 * 60;
  db.prepare('INSERT INTO seasonal_events (id, name, description, start_date, end_date, rewards) VALUES (?, ?, ?, ?, ?, ?)')
    .run(genId(), 'Foire marchande', 'Les ventes automatiques de ressources au marche rapportent x1,5 or!', now, now + twoWeeks, JSON.stringify({ marketSellMultiplier: 1.5 }));
  console.log('[Game] Added market sell event');
}

// =============================================
// START SERVER
// =============================================

httpServer.listen(PORT, HOST, () => {
  console.log(`[Game Server] Running on http://${HOST}:${PORT}`);
  startAutoBackup();
});
