// Client-side mirror of server troop configs + sprite mapping.
// Used for the recruitment UI (cost preview) and combat animations.

export interface TroopStat {
  name: string;
  icon: string;
  cost: Record<string, number>;
  costMultiplier: number;
  attack: number; defense: number; hp: number; speed: number;
  minTier: number; foodUpkeep: number; trainingTime: number;
  sprite: string;       // sprite key under /sprites
  accent: string;       // tailwind gradient classes for the card
  role: TroopRole;
  roleBonus: string;
  description: string;
}

export type TroopRole = 'tank' | 'dps' | 'ranged' | 'healer' | 'mage' | 'assassin' | 'cavalry' | 'paladin' | 'evade' | 'paralyze';

export const ROLE_INFO: Record<TroopRole, { name: string; icon: string; atout: string }> = {
  tank:     { name: 'Tank',       icon: '🛡️', atout: 'Réduit les pertes de toute l\'armée (encaisse les coups).' },
  dps:      { name: 'Combattant', icon: '⚔️', atout: 'Dégâts de mêlée fiables et polyvalents.' },
  ranged:   { name: 'Distance',   icon: '🏹', atout: 'Frappe avant le contact, bonus d\'attaque d\'ouverture.' },
  healer:   { name: 'Soigneur',   icon: '✨', atout: 'Soigne l\'armée : augmente fortement le taux de survie.' },
  mage:     { name: 'Mage',       icon: '🔮', atout: 'Dégâts de zone magiques, ignore une partie de la défense.' },
  assassin: { name: 'Assassin',   icon: '🌑', atout: 'Cible les unités fragiles ennemies, gros pic de dégâts.' },
  cavalry:  { name: 'Cavalerie',  icon: '🐉', atout: 'Charge rapide : bonus de dégâts en supériorité.' },
  paladin:  { name: 'Paladin',    icon: '⭐', atout: 'Hybride soin + défense, stabilise les troupes blessées.' },
  evade:    { name: 'Tireur',     icon: '🤠', atout: 'Agile : esquive totale 20% (niv.1) jusqu\'à 40% (niv.10).' },
  paralyze: { name: 'Paralyseur', icon: '🍃', atout: 'Paralyse l\'ennemi 10% (niv.1) jusqu\'à 30% (niv.10) : il saute son tour.' },
};

export const TROOP_MAX_LEVEL = 10;

// Niveau d'Hôtel de Ville requis par palier (miroir serveur TIERS).
const TIER_TOWN_HALL_LEVEL: Record<number, number> = { 1: 1, 2: 3, 3: 5, 4: 8, 5: 12, 6: 17, 7: 23, 8: 30 };
export function townHallLevelForTier(tier: number): number {
  return TIER_TOWN_HALL_LEVEL[tier] ?? 1;
}

// Stats d'un type au niveau donné (miroir serveur : +12%/niveau).
export function troopStatsAtLevel(cfg: TroopStat, level: number) {
  const mult = 1 + (Math.max(1, level) - 1) * 0.12;
  return {
    attack: Math.round(cfg.attack * mult),
    defense: Math.round(cfg.defense * mult),
    hp: Math.round(cfg.hp * mult),
    speed: cfg.speed,
  };
}

// Coût d'amélioration (miroir serveur).
export function computeTroopUpgradeCost(cfg: TroopStat, currentLevel: number): Record<string, number> {
  const factor = Math.pow(1.8, currentLevel - 1);
  const base = (cfg.cost.stone + cfg.cost.iron + cfg.cost.gold + cfg.cost.wood + cfg.cost.magic_energy) * 1.5;
  return {
    stone: Math.floor(base * 0.4 * factor),
    iron: Math.floor(base * 0.4 * factor),
    gold: Math.floor((50 + base * 0.25) * factor),
    food: 0,
    wood: Math.floor(base * 0.2 * factor),
    magic_energy: Math.floor((cfg.cost.magic_energy + 10) * factor),
  };
}

export const TROOP_DATA: Record<string, TroopStat> = {
  soldier: {
    name: 'Prince', icon: '🤴',
    cost: { stone: 50, iron: 80, gold: 40, food: 30, wood: 20, magic_energy: 0 },
    costMultiplier: 1.35, attack: 26, defense: 5, hp: 45, speed: 8,
    minTier: 1, foodUpkeep: 1, trainingTime: 35,
    sprite: 'prince', accent: 'from-blue-600 to-blue-900',
    role: 'dps', roleBonus: 'Frappe très fort mais fragile (peu de PV).',
    description: 'Lame d\'élite : énormes dégâts, mais tombe vite.'
  },
  archer: {
    name: 'Elfe', icon: '🧝',
    cost: { stone: 20, iron: 40, gold: 50, food: 20, wood: 80, magic_energy: 10 },
    costMultiplier: 1.35, attack: 14, defense: 6, hp: 60, speed: 9,
    minTier: 2, foodUpkeep: 1.2, trainingTime: 50,
    sprite: 'elf', accent: 'from-green-700 to-emerald-900',
    role: 'paralyze', roleBonus: 'Paralyse l\'ennemi : 10% au niv.1, +2%/niveau, jusqu\'à 30% au niv.10.',
    description: 'Lancière sylvestre : entrave l\'ennemi de ses sorts.'
  },
  knight: {
    name: 'Nain', icon: '🧔',
    cost: { stone: 130, iron: 160, gold: 50, food: 50, wood: 30, magic_energy: 0 },
    costMultiplier: 1.4, attack: 9, defense: 22, hp: 220, speed: 3,
    minTier: 3, foodUpkeep: 2, trainingTime: 90,
    sprite: 'dwarf', accent: 'from-amber-700 to-stone-800',
    role: 'tank', roleBonus: 'Encaisse EN PREMIER : les nains meurent avant les autres troupes.',
    description: 'Mur d\'acier barbu : protège l\'armée en mourant en premier.'
  },
  mage_guard: {
    name: 'Cowboy', icon: '🤠',
    cost: { stone: 40, iron: 60, gold: 100, food: 30, wood: 20, magic_energy: 20 },
    costMultiplier: 1.45, attack: 22, defense: 8, hp: 80, speed: 11,
    minTier: 4, foodUpkeep: 2, trainingTime: 110,
    sprite: 'cowboy', accent: 'from-amber-800 to-yellow-950',
    role: 'evade', roleBonus: 'Esquive UNIQUEMENT pour lui-même : 20% (niv.1) jusqu\'à 40% (niv.10).',
    description: 'Tireur d\'élite : esquive sa part des attaques.'
  },
  golem: {
    name: 'Golem', icon: '🗿',
    cost: { stone: 300, iron: 200, gold: 100, food: 0, wood: 50, magic_energy: 80 },
    costMultiplier: 1.6, attack: 15, defense: 30, hp: 300, speed: 2,
    minTier: 5, foodUpkeep: 0, trainingTime: 180,
    sprite: 'golem', accent: 'from-stone-500 to-stone-700',
    role: 'tank', roleBonus: 'Réduit l\'attaque ennemie de 12% (niv.1) jusqu\'à 30% (niv.10).',
    description: 'Créature de pierre : affaiblit les attaques ennemies.'
  },
  dragon_rider: {
    name: 'Chevaucheur de dragon', icon: '🐉',
    cost: { stone: 200, iron: 300, gold: 200, food: 100, wood: 50, magic_energy: 150 },
    costMultiplier: 1.7, attack: 40, defense: 20, hp: 200, speed: 10,
    minTier: 6, foodUpkeep: 5, trainingTime: 300,
    sprite: 'soldier', accent: 'from-red-700 to-orange-800',
    role: 'cavalry', roleBonus: 'Charge aérienne dévastatrice en supériorité.',
    description: 'Puissant cavalier sur dragon, domination aérienne.'
  },
  shadow_assassin: {
    name: 'Assassin de l\'ombre', icon: '🌑',
    cost: { stone: 100, iron: 150, gold: 150, food: 40, wood: 20, magic_energy: 120 },
    costMultiplier: 1.6, attack: 50, defense: 5, hp: 60, speed: 12,
    minTier: 7, foodUpkeep: 3, trainingTime: 240,
    sprite: 'archer', accent: 'from-indigo-800 to-slate-900',
    role: 'assassin', roleBonus: 'Exécute les unités fragiles ennemies.',
    description: 'Frappe furtive dévastatrice, très fragile.'
  },
  holy_paladin: {
    name: 'Prêtre', icon: '🙏',
    cost: { stone: 200, iron: 150, gold: 300, food: 80, wood: 100, magic_energy: 220 },
    costMultiplier: 1.8, attack: 12, defense: 14, hp: 160, speed: 5,
    minTier: 8, foodUpkeep: 4, trainingTime: 340,
    sprite: 'priest', accent: 'from-amber-400 to-yellow-700',
    role: 'healer', roleBonus: 'Soigne l\'armée chaque tour : survie fortement accrue.',
    description: 'Clerc sacré : restaure les PV de toute l\'armée.'
  }
};

// Number of animation frames available per sprite key
export const SPRITE_FRAMES: Record<string, number> = {
  soldier: 5, archer: 5, mage: 5, golem: 5, goblin: 5, ogre: 5,
  slime: 5, dragonfrog: 5,
  prince: 5, elf: 5, dwarf: 5, cowboy: 5, priest: 5,
};

// Enemy sprites for campaign / tower battles
export const ENEMY_SPRITES = ['goblin', 'ogre', 'golem', 'slime', 'dragonfrog'] as const;

// 40 escalating bosses (names mirror the server)
export const BOSS_NAMES: string[] = [
  'Roi Squelette', 'Hydre Ardente', 'Archange Déchu', 'Horreur Tentaculaire', 'Élémentaire de Magma',
  'Dragon des Cendres', 'Colosse de Fer', 'Seigneur Démon', 'Golem de Glace', 'Esprit Cristallin',
  'Veuve Noire', 'Comte Vampire', 'Liche Suprême', 'Kraken Abyssal', 'Léviathan des Mers',
  'Flamme du Vide', 'Automate Ancien', 'Galion Maudit', 'Capitaine Spectral', 'Plante Carnivore',
  'Manticore', 'Ent Gardien', 'Chauve-Souris Géante', 'Basilic Venimeux', 'Serpent Émeraude',
  'Sphinx Doré', 'Gorgone', 'Méduse Pétrifiante', 'Phénix Renaissant', 'Cthulhu Mineur',
  'Gargouille de Pierre', 'Griffon Royal', 'Titan de Givre', 'Cheval de l\'Apocalypse', 'Fléau Visqueux',
  'Aberration du Néant', 'Scarabée Cosmique', 'Hydre des Abysses', 'Tisseur de Cauchemars', 'Dévoreur de Mondes'
];

export function bossDifficultyLabel(i: number): string {
  if (i <= 8) return 'Facile';
  if (i <= 18) return 'Modéré';
  if (i <= 28) return 'Difficile';
  if (i <= 36) return 'Cauchemar';
  return 'Légendaire';
}

// Compute recruit cost for `count` units given `existing` already owned.
export function computeTroopCost(type: string, count: number, existing = 0) {
  const cfg = TROOP_DATA[type];
  const out: Record<string, number> = {};
  for (const res of ['stone', 'iron', 'gold', 'food', 'wood', 'magic_energy']) {
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor((cfg.cost[res] || 0) * Math.pow(cfg.costMultiplier, Math.floor((existing + i) / 10)));
    }
    out[res] = total;
  }
  return out;
}

// ============================================================
// BOSS DROPS — chaque boss possède UN objet signature.
// boss_item_{NN}.png (sous /items) correspond au boss du même numéro.
// Survol d'un boss => objet + chance de drop affichés.
// ============================================================
export type ItemSlot =
  | 'armor_helmet' | 'armor_shoulders' | 'armor_gloves' | 'armor_chest'
  | 'armor_boots' | 'armor_shield' | 'armor_bracers' | 'armor_relic';

export interface BossItem {
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  slot: ItemSlot;
  effects: Record<string, number>;   // attack/defense/hp/magic/speed/crit
  dropChance: number;                 // % (0-100)
  icon: string;                       // /items/boss_item_NN.png
}

const ITEM_SLOTS: ItemSlot[] = [
  'armor_helmet', 'armor_shoulders', 'armor_gloves', 'armor_chest',
  'armor_boots', 'armor_shield', 'armor_bracers', 'armor_relic',
];

// Noms d'objets signature, un par boss (index = boss - 1).
const BOSS_ITEM_NAMES: string[] = [
  'Couronne du Roi Squelette', 'Écaille de l\'Hydre Ardente', 'Aile de l\'Archange Déchu', 'Tentacule Cauchemardesque', 'Cœur de Magma',
  'Croc du Dragon des Cendres', 'Poing du Colosse de Fer', 'Sceau du Seigneur Démon', 'Éclat de Glace Éternelle', 'Prisme Cristallin',
  'Dard de la Veuve Noire', 'Calice du Comte Vampire', 'Phylactère de la Liche', 'Œil du Kraken', 'Trident du Léviathan',
  'Braise du Vide', 'Rouage de l\'Automate', 'Ancre du Galion Maudit', 'Boussole Spectrale', 'Vrille Carnivore',
  'Épine de Manticore', 'Écorce de l\'Ent Gardien', 'Membrane de Chauve-Souris', 'Venin de Basilic', 'Anneau du Serpent Émeraude',
  'Énigme du Sphinx', 'Mèche de Gorgone', 'Regard Pétrifiant', 'Plume de Phénix', 'Idole de Cthulhu',
  'Croc de Gargouille', 'Serre du Griffon Royal', 'Givre du Titan', 'Faux de l\'Apocalypse', 'Fléau Visqueux',
  'Fragment du Néant', 'Carapace Cosmique', 'Vertèbre des Abysses', 'Fil de Cauchemar', 'Couronne du Dévoreur de Mondes',
];

// Génère l'objet d'un boss (déterministe). i = numéro de boss (1..40).
function buildBossItem(i: number): BossItem {
  const rarity: BossItem['rarity'] =
    i <= 8 ? 'common' : i <= 18 ? 'rare' : i <= 28 ? 'epic' : 'legendary';
  // Drop : plus le boss est dur, plus l'objet est rare (chance plus faible).
  const dropChance =
    i <= 8 ? 45 : i <= 18 ? 32 : i <= 28 ? 20 : i <= 36 ? 12 : 7;
  // Stats croissantes avec le palier.
  const power = 4 + i * 2;                 // valeur principale
  const second = Math.round(power * 0.5);  // valeur secondaire
  // Rotation de la stat principale selon le boss pour la variété.
  const mainStats = ['attack', 'defense', 'hp', 'magic', 'speed', 'crit'];
  const main = mainStats[(i - 1) % mainStats.length];
  const sec = mainStats[i % mainStats.length];
  const effects: Record<string, number> = {};
  effects[main] = main === 'hp' ? power * 4 : power;
  if (sec !== main) effects[sec] = sec === 'hp' ? second * 4 : second;
  return {
    name: BOSS_ITEM_NAMES[i - 1] || `Trophée du boss #${i}`,
    rarity,
    slot: ITEM_SLOTS[(i - 1) % ITEM_SLOTS.length],
    effects,
    dropChance,
    icon: `/items/boss_item_${String(i).padStart(2, '0')}.png`,
  };
}

// Table figée des 40 objets de boss.
export const BOSS_ITEMS: BossItem[] = Array.from({ length: 40 }, (_, k) => buildBossItem(k + 1));

export function bossItem(bossIndex: number): BossItem | null {
  return BOSS_ITEMS[bossIndex - 1] || null;
}

// ============================================================
// CAMPAGNE — décors + monstres animés par chapitre.
// Images sous /campaign/ch{NN}/ :
//   decor_1.png, decor_2.png      → décor animé (2 frames)
//   mon{1..5}_frame{1..5}.png     → 5 monstres normaux (5 frames chacun)
//   boss_frame{1..5}.png          → boss du chapitre (5 frames)
// ============================================================
export interface CampaignChapter {
  id: number;
  name: string;
  monsters: string[];   // 5 noms de monstres normaux
  boss: string;         // nom du boss
}

export const CAMPAIGN_CHAPTERS: CampaignChapter[] = [
  { id: 1,  name: 'Forêt Enchantée',         monsters: ['Imp Épineux', 'Louveteau Forestier', 'Sprite Champignon', 'Rampeur de Vignes', "Gobelin d'Écorce"],            boss: 'Tréant Ancien' },
  { id: 2,  name: 'Désert Ancien',           monsters: ['Scarabée des Sables', 'Lézard des Dunes', 'Scorpion Désertique', 'Éclaireur Momie', 'Brute Vautour'],            boss: 'Ver des Sables' },
  { id: 3,  name: 'Toundra Gelée',           monsters: ['Lutin de Glace', 'Loup des Neiges', 'Chauve-Souris Givrée', 'Maraudeur Pingouin', 'Bébé Yéti Cristallin'],       boss: 'Géant du Givre' },
  { id: 4,  name: 'Marais Toxique',          monsters: ['Slime des Bourbiers', 'Guerrier Grenouille', 'Démon Moustique', 'Lézard des Marais', 'Druide Pourri'],            boss: 'Hydre du Marais' },
  { id: 5,  name: 'Profondeurs Volcaniques', monsters: ['Slime de Magma', 'Chien de Cendres', 'Diablotin de Lave', 'Chauve-Souris Braise', 'Golem Obsidienne'],           boss: 'Dragon de Magma' },
  { id: 6,  name: 'Crypte Maudite',          monsters: ['Soldat Squelette', 'Feu Follet', "Chien d'Os", 'Corbeau Funeste', 'Cultiste Zombie'],                            boss: 'Liche Souveraine' },
  { id: 7,  name: 'Abysse Océanique',        monsters: ['Crabe de Corail', 'Démon Piranha', "Traqueur d'Algues", 'Spectre Méduse', 'Brute Carapace'],                    boss: 'Kraken Abyssal' },
  { id: 8,  name: 'Temple des Cieux',        monsters: ['Éclaireuse Harpie', "Élémentaire d'Orage", 'Griffonnet', 'Serpent des Nuages', 'Moine du Tonnerre'],             boss: 'Griffon Tempête' },
  { id: 9,  name: 'Grottes de Cristal',      monsters: ['Éclat Vivant', 'Scarabée Gemme', 'Slime Prismatique', 'Gargouille Quartz', 'Araignée Cristal'],                 boss: 'Colosse Cristallin' },
  { id: 10, name: 'Citadelle du Néant',      monsters: ['Imp Ombre', 'Œil du Vide', 'Traqueur du Néant', 'Chien de Cauchemar', "Cultiste de l'Éclipse"],                  boss: 'Faucheur du Vide' },
];

export function campaignChapter(ch: number): CampaignChapter | null {
  return CAMPAIGN_CHAPTERS[ch - 1] || null;
}

// Chemins d'images pour un chapitre donné.
export function campaignDecorFrames(ch: number): string[] {
  return [`/campaign/ch${String(ch).padStart(2, '0')}/decor_1.png`, `/campaign/ch${String(ch).padStart(2, '0')}/decor_2.png`];
}
export function campaignMonsterFrames(ch: number, monsterIndex: number): string[] {
  // monsterIndex : 1..5
  const c = String(ch).padStart(2, '0');
  return Array.from({ length: 5 }, (_, f) => `/campaign/ch${c}/mon${monsterIndex}_frame${f + 1}.png`);
}
export function campaignBossFrames(ch: number): string[] {
  const c = String(ch).padStart(2, '0');
  return Array.from({ length: 5 }, (_, f) => `/campaign/ch${c}/boss_frame${f + 1}.png`);
}

// ============================================================
// ITEMS DE BOSS DE CAMPAGNE — un objet unique par chapitre (boss = épisode 10).
// Sans statistiques (objet de collection). Image : /campaign_items/{ch}.png
// {ch}.png correspond au boss du chapitre {ch}.
// ============================================================
// Nom de l'item = trophée du boss du chapitre (boss défini dans CAMPAIGN_CHAPTERS).
export function campaignBossItemIcon(chapter: number): string {
  return `/campaign_items/${chapter}.png`;
}
export function campaignBossItemName(chapter: number): string {
  const ch = campaignChapter(chapter);
  return ch ? `Trophée — ${ch.boss}` : `Trophée du chapitre ${chapter}`;
}
