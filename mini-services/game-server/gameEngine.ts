// Game Configuration & Engine
// All game balance, formulas, and mechanics

export const RESOURCES = ['stone', 'iron', 'gold', 'food', 'wood', 'magic_energy'] as const;
export type ResourceType = typeof RESOURCES[number];

export const RESOURCE_NAMES: Record<ResourceType, string> = {
  stone: 'Pierre',
  iron: 'Fer',
  gold: 'Or',
  food: 'Nourriture',
  wood: 'Bois',
  magic_energy: 'Énergie magique'
};

export const RESOURCE_ICONS: Record<ResourceType, string> = {
  stone: '🪨',
  iron: '⛏️',
  gold: '🪙',
  food: '🌾',
  wood: '🪵',
  magic_energy: '✨'
};

// Building types and their properties
export interface BuildingConfig {
  name: string;
  icon: string;
  baseCost: Record<ResourceType, number>;
  costMultiplier: number;
  productionPerWorker: Record<ResourceType, number>;
  consumptionPerWorker: Partial<Record<ResourceType, number>>;
  maxWorkersBase: number;
  maxWorkersPerLevel: number;
  minTier: number;
  description: string;
}

export const BUILDING_TYPES = ['mine', 'lumberjack', 'farm', 'forge', 'barracks', 'library', 'sanctuary', 'town_hall'] as const;
export type BuildingType = typeof BUILDING_TYPES[number];

export const BUILDINGS: Record<BuildingType, BuildingConfig> = {
  mine: {
    name: 'Mine',
    icon: '⛏️',
    baseCost: { stone: 100, iron: 50, gold: 30, food: 0, wood: 80, magic_energy: 0 },
    costMultiplier: 1.5,
    productionPerWorker: { stone: 2.5, iron: 1.85, gold: 0, food: 0, wood: 0, magic_energy: 0 },
    consumptionPerWorker: { food: 0.5 },
    maxWorkersBase: 5,
    maxWorkersPerLevel: 2,
    minTier: 1,
    description: 'Les mineurs extraient la pierre et le fer.'
  },
  lumberjack: {
    name: 'Bûcheron',
    icon: '🪓',
    baseCost: { stone: 70, iron: 25, gold: 10, food: 0, wood: 40, magic_energy: 0 },
    costMultiplier: 1.45,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 0, wood: 3.0, magic_energy: 0 },
    consumptionPerWorker: { food: 0.4 },
    maxWorkersBase: 5,
    maxWorkersPerLevel: 2,
    minTier: 1,
    description: 'Les bûcherons coupent du bois pour alimenter les constructions et les améliorations.'
  },
  farm: {
    name: 'Ferme',
    icon: '🌾',
    baseCost: { stone: 60, iron: 20, gold: 10, food: 0, wood: 100, magic_energy: 0 },
    costMultiplier: 1.4,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 3.0, wood: 0, magic_energy: 0 },
    consumptionPerWorker: {},
    maxWorkersBase: 6,
    maxWorkersPerLevel: 2,
    minTier: 1,
    description: 'Les fermiers produisent la nourriture nécessaire au village.'
  },
  forge: {
    name: 'Forge',
    icon: '🔥',
    baseCost: { stone: 150, iron: 100, gold: 50, food: 0, wood: 50, magic_energy: 10 },
    costMultiplier: 1.6,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 0 },
    consumptionPerWorker: { iron: 2.0, stone: 1.0, food: 0.5 },
    maxWorkersBase: 4,
    maxWorkersPerLevel: 1,
    minTier: 2,
    description: 'Les forgerons transforment les ressources en armures et équipements.'
  },
  barracks: {
    name: 'Caserne',
    icon: '⚔️',
    baseCost: { stone: 200, iron: 150, gold: 80, food: 0, wood: 100, magic_energy: 20 },
    costMultiplier: 1.7,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 0 },
    consumptionPerWorker: { food: 1.0 },
    maxWorkersBase: 3,
    maxWorkersPerLevel: 1,
    minTier: 1,
    description: 'La caserne permet de recruter et entraîner des troupes.'
  },
  library: {
    name: 'Bibliothèque magique',
    icon: '📚',
    baseCost: { stone: 200, iron: 50, gold: 100, food: 0, wood: 150, magic_energy: 50 },
    costMultiplier: 1.8,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 0 },
    consumptionPerWorker: { gold: 0.5, magic_energy: 0.2 },
    maxWorkersBase: 3,
    maxWorkersPerLevel: 1,
    minTier: 3,
    description: 'La bibliothèque entraîne le héros : +0,5 XP par ouvrier toutes les 5 min.'
  },
  sanctuary: {
    name: 'Sanctuaire',
    icon: '🏛️',
    baseCost: { stone: 300, iron: 100, gold: 150, food: 0, wood: 200, magic_energy: 100 },
    costMultiplier: 1.8,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 2.0 },
    consumptionPerWorker: { gold: 0.3, food: 0.3 },
    maxWorkersBase: 3,
    maxWorkersPerLevel: 1,
    minTier: 3,
    description: 'Le sanctuaire génère de l\'Énergie magique pour vos recherches.'
  },
  town_hall: {
    name: 'Hôtel de Ville',
    icon: '🏰',
    baseCost: { stone: 500, iron: 300, gold: 200, food: 100, wood: 400, magic_energy: 50 },
    costMultiplier: 2.0,
    productionPerWorker: { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 0 },
    consumptionPerWorker: {},
    maxWorkersBase: 0,
    maxWorkersPerLevel: 0,
    minTier: 1,
    description: 'L\'Hôtel de Ville détermine le palier du village et débloque de nouvelles constructions.'
  }
};

// Troop types
export interface TroopConfig {
  name: string;
  icon: string;
  cost: Record<ResourceType, number>;
  costMultiplier: number;
  attack: number;
  defense: number;
  hp: number;
  speed: number;
  minTier: number;
  foodUpkeep: number;
  trainingTime: number; // seconds
  role: TroopRole;
  roleBonus: string; // texte d'atout affiché
  description: string;
}

// Rôles tactiques : chacun confère un atout d'équipe distinct en combat.
export type TroopRole = 'tank' | 'dps' | 'ranged' | 'healer' | 'mage' | 'assassin' | 'cavalry' | 'paladin' | 'evade' | 'paralyze';

export const ROLE_INFO: Record<TroopRole, { name: string; icon: string; atout: string }> = {
  tank:     { name: 'Tank',      icon: '🛡️', atout: 'Réduit les pertes de toute l\'armée (encaisse les coups).' },
  dps:      { name: 'Combattant', icon: '⚔️', atout: 'Dégâts de mêlée fiables et polyvalents.' },
  ranged:   { name: 'Distance',  icon: '🏹', atout: 'Frappe avant le contact, bonus d\'attaque d\'ouverture.' },
  healer:   { name: 'Soigneur',  icon: '✨', atout: 'Soigne l\'armée : augmente fortement le taux de survie.' },
  mage:     { name: 'Mage',      icon: '🔮', atout: 'Dégâts de zone magiques, ignore une partie de la défense.' },
  assassin: { name: 'Assassin',  icon: '🌑', atout: 'Cible les unités fragiles ennemies, gros pic de dégâts.' },
  cavalry:  { name: 'Cavalerie', icon: '🐉', atout: 'Charge rapide : bonus de dégâts si l\'armée est en supériorité.' },
  paladin:  { name: 'Paladin',   icon: '⭐', atout: 'Hybride soin + défense, stabilise les troupes blessées.' },
  evade:    { name: 'Tireur',    icon: '🤠', atout: 'Agile : esquive totale 20% (niv.1) jusqu\'à 40% (niv.10).' },
  paralyze: { name: 'Paralyseur', icon: '🍃', atout: 'Paralyse l\'ennemi 10% (niv.1) jusqu\'à 30% (niv.10) : il saute son tour.' },
};


export const TROOP_TYPES = ['soldier', 'archer', 'knight', 'mage_guard', 'golem', 'dragon_rider', 'shadow_assassin', 'holy_paladin'] as const;
export type TroopType = typeof TROOP_TYPES[number];

export const TROOPS: Record<TroopType, TroopConfig> = {
  soldier: {
    name: 'Prince',
    icon: '🤴',
    cost: { stone: 50, iron: 80, gold: 40, food: 30, wood: 20, magic_energy: 0 },
    costMultiplier: 1.35,
    attack: 26, defense: 5, hp: 45, speed: 8,
    minTier: 1, foodUpkeep: 1, trainingTime: 35,
    role: 'dps', roleBonus: 'Frappe très fort mais fragile (peu de PV).',
    description: 'Lame d\'élite : énormes dégâts, mais tombe vite.'
  },
  archer: {
    name: 'Elfe',
    icon: '🧝',
    cost: { stone: 20, iron: 40, gold: 50, food: 20, wood: 80, magic_energy: 10 },
    costMultiplier: 1.35,
    attack: 14, defense: 6, hp: 60, speed: 9,
    minTier: 2, foodUpkeep: 1.2, trainingTime: 50,
    role: 'paralyze', roleBonus: 'Paralyse l\'ennemi : 10% au niv.1, +2%/niveau, jusqu\'à 30% au niv.10.',
    description: 'Lancière sylvestre : entrave l\'ennemi de ses sorts.'
  },
  knight: {
    name: 'Nain',
    icon: '🧔',
    cost: { stone: 130, iron: 160, gold: 50, food: 50, wood: 30, magic_energy: 0 },
    costMultiplier: 1.4,
    attack: 9, defense: 22, hp: 220, speed: 3,
    minTier: 3, foodUpkeep: 2, trainingTime: 90,
    role: 'tank', roleBonus: 'Énormément de PV, peu d\'attaque : encaisse pour l\'équipe.',
    description: 'Mur d\'acier barbu : encaisse tout, frappe peu.'
  },
  mage_guard: {
    name: 'Cowboy',
    icon: '🤠',
    cost: { stone: 40, iron: 60, gold: 100, food: 30, wood: 20, magic_energy: 20 },
    costMultiplier: 1.45,
    attack: 22, defense: 8, hp: 80, speed: 11,
    minTier: 4, foodUpkeep: 2, trainingTime: 110,
    role: 'evade', roleBonus: 'Esquive totale : 20% au niv.1, +2%/niveau, jusqu\'à 40% au niv.10.',
    description: 'Tireur d\'élite : rapide et difficile à toucher.'
  },
  golem: {
    name: 'Golem',
    icon: '🗿',
    cost: { stone: 300, iron: 200, gold: 100, food: 0, wood: 50, magic_energy: 80 },
    costMultiplier: 1.6,
    attack: 15, defense: 30, hp: 300, speed: 2,
    minTier: 5, foodUpkeep: 0, trainingTime: 180,
    role: 'tank', roleBonus: 'Encaisse énormément, réduit les pertes globales.',
    description: 'Créature de pierre, résistante mais lente.'
  },
  dragon_rider: {
    name: 'Chevaucheur de dragon',
    icon: '🐉',
    cost: { stone: 200, iron: 300, gold: 200, food: 100, wood: 50, magic_energy: 150 },
    costMultiplier: 1.7,
    attack: 40, defense: 20, hp: 200, speed: 10,
    minTier: 6, foodUpkeep: 5, trainingTime: 300,
    role: 'cavalry', roleBonus: 'Charge aérienne dévastatrice en supériorité.',
    description: 'Puissant cavalier sur dragon, domination aérienne.'
  },
  shadow_assassin: {
    name: 'Assassin de l\'ombre',
    icon: '🌑',
    cost: { stone: 100, iron: 150, gold: 150, food: 40, wood: 20, magic_energy: 120 },
    costMultiplier: 1.6,
    attack: 50, defense: 5, hp: 60, speed: 12,
    minTier: 7, foodUpkeep: 3, trainingTime: 240,
    role: 'assassin', roleBonus: 'Exécute les unités fragiles ennemies.',
    description: 'Frappe furtive dévastatrice, très fragile.'
  },
  holy_paladin: {
    name: 'Prêtre',
    icon: '🙏',
    cost: { stone: 200, iron: 150, gold: 300, food: 80, wood: 100, magic_energy: 220 },
    costMultiplier: 1.8,
    attack: 12, defense: 14, hp: 160, speed: 5,
    minTier: 8, foodUpkeep: 4, trainingTime: 340,
    role: 'healer', roleBonus: 'Soigne l\'armée chaque tour : survie fortement accrue.',
    description: 'Clerc sacré : restaure les PV de toute l\'armée.'
  }
};

// Town Hall tier configurations
export interface TierConfig {
  tier: number;
  townHallLevel: number;
  maxBuildings: Record<BuildingType, number>;
  resourceCapMultiplier: number;
  productionBonus: number;
  unlockTroops: TroopType[];
  unlockBuildings: BuildingType[];
}

export const TIERS: TierConfig[] = [
  { tier: 1, townHallLevel: 1, maxBuildings: { mine: 1, lumberjack: 1, farm: 2, forge: 0, barracks: 0, library: 0, sanctuary: 0, town_hall: 1 }, resourceCapMultiplier: 1, productionBonus: 0, unlockTroops: ['soldier'], unlockBuildings: ['mine', 'lumberjack', 'farm', 'town_hall'] },
  { tier: 2, townHallLevel: 3, maxBuildings: { mine: 2, lumberjack: 2, farm: 3, forge: 1, barracks: 0, library: 0, sanctuary: 0, town_hall: 1 }, resourceCapMultiplier: 1.5, productionBonus: 0.1, unlockTroops: ['archer'], unlockBuildings: ['forge'] },
  { tier: 3, townHallLevel: 5, maxBuildings: { mine: 3, lumberjack: 3, farm: 4, forge: 2, barracks: 0, library: 1, sanctuary: 1, town_hall: 1 }, resourceCapMultiplier: 2, productionBonus: 0.2, unlockTroops: ['knight'], unlockBuildings: ['library', 'sanctuary'] },
  { tier: 4, townHallLevel: 8, maxBuildings: { mine: 4, lumberjack: 4, farm: 5, forge: 3, barracks: 0, library: 1, sanctuary: 1, town_hall: 1 }, resourceCapMultiplier: 3, productionBonus: 0.3, unlockTroops: ['mage_guard'], unlockBuildings: [] },
  { tier: 5, townHallLevel: 12, maxBuildings: { mine: 5, lumberjack: 5, farm: 6, forge: 3, barracks: 0, library: 2, sanctuary: 2, town_hall: 1 }, resourceCapMultiplier: 4, productionBonus: 0.4, unlockTroops: ['golem'], unlockBuildings: [] },
  { tier: 6, townHallLevel: 17, maxBuildings: { mine: 6, lumberjack: 6, farm: 7, forge: 4, barracks: 0, library: 2, sanctuary: 2, town_hall: 1 }, resourceCapMultiplier: 5, productionBonus: 0.5, unlockTroops: ['dragon_rider'], unlockBuildings: [] },
  { tier: 7, townHallLevel: 23, maxBuildings: { mine: 7, lumberjack: 7, farm: 8, forge: 5, barracks: 0, library: 3, sanctuary: 3, town_hall: 1 }, resourceCapMultiplier: 7, productionBonus: 0.6, unlockTroops: ['shadow_assassin'], unlockBuildings: [] },
  { tier: 8, townHallLevel: 30, maxBuildings: { mine: 9, lumberjack: 9, farm: 10, forge: 6, barracks: 0, library: 4, sanctuary: 4, town_hall: 1 }, resourceCapMultiplier: 10, productionBonus: 0.8, unlockTroops: ['holy_paladin'], unlockBuildings: [] },
];

// Get tier from town hall level
export function getTierForLevel(level: number): number {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (level >= TIERS[i].townHallLevel) return TIERS[i].tier;
  }
  return 1;
}

// Get tier config
export function getTierConfig(tier: number): TierConfig {
  // Les déblocages sont CUMULATIFS : on garde l'accès à tout ce qui a été
  // débloqué aux paliers précédents (le joueur choisit ce qu'il produit).
  const cumulativeTroops = (uptoTier: number): TroopType[] => {
    const set = new Set<TroopType>();
    for (let i = 0; i < Math.min(uptoTier, TIERS.length); i++) {
      for (const t of TIERS[i].unlockTroops) set.add(t);
    }
    if (uptoTier > TIERS.length) for (const t of TROOP_TYPES) set.add(t);
    return [...set];
  };
  const cumulativeBuildings = (uptoTier: number): BuildingType[] => {
    const set = new Set<BuildingType>();
    for (let i = 0; i < Math.min(uptoTier, TIERS.length); i++) {
      for (const b of TIERS[i].unlockBuildings) set.add(b);
    }
    if (uptoTier > TIERS.length) for (const b of BUILDING_TYPES) set.add(b);
    return [...set];
  };

  if (tier <= TIERS.length) {
    return { ...TIERS[tier - 1], unlockTroops: cumulativeTroops(tier), unlockBuildings: cumulativeBuildings(tier) };
  }
  // Infinite scaling beyond tier 8
  const lastTier = TIERS[TIERS.length - 1];
  const extraTiers = tier - TIERS.length;
  return {
    tier,
    townHallLevel: lastTier.townHallLevel + extraTiers * 10,
    maxBuildings: {
      mine: lastTier.maxBuildings.mine + extraTiers * 2,
      lumberjack: lastTier.maxBuildings.lumberjack + extraTiers * 2,
      farm: lastTier.maxBuildings.farm + extraTiers * 2,
      forge: lastTier.maxBuildings.forge + extraTiers,
      barracks: 0,
      library: lastTier.maxBuildings.library + extraTiers,
      sanctuary: lastTier.maxBuildings.sanctuary + extraTiers,
      town_hall: 1
    },
    resourceCapMultiplier: lastTier.resourceCapMultiplier * Math.pow(1.5, extraTiers),
    productionBonus: Math.min(lastTier.productionBonus + extraTiers * 0.1, 2.0),
    unlockTroops: [...TROOP_TYPES],
    unlockBuildings: [...BUILDING_TYPES]
  };
}

// Calculate building upgrade cost
export function getBuildingUpgradeCost(type: BuildingType, currentLevel: number): Record<ResourceType, number> {
  const config = BUILDINGS[type];
  const cost: Record<ResourceType, number> = {} as any;
  for (const res of RESOURCES) {
    cost[res] = Math.floor(config.baseCost[res] * Math.pow(config.costMultiplier, currentLevel));
  }
  return cost;
}

// Max ouvriers par bâtiment : 5, fixe (indépendant du niveau).
export function getMaxWorkers(_type: BuildingType, _level: number): number {
  return 5;
}

// Limite d'ouvriers que le village peut posséder : grandit avec l'Hôtel de Ville.
export function getWorkerPoolCap(townHallLevel = 1): number {
  return 10 + (townHallLevel - 1) * 3;
}

// Prix en or pour acheter un ouvrier supplémentaire (croissant avec le nombre déjà possédé).
export function getWorkerPurchaseCost(currentPool: number): number {
  return Math.floor(150 * Math.pow(1.25, Math.max(0, currentPool - 10)));
}

// Calculate resource caps for tier and town-hall level.
// Storage grows with the town hall so production has room to accumulate
// instead of sitting pinned at the cap.
export function getResourceCaps(tier: number, townHallLevel = 1): Record<ResourceType, number> {
  // Plafond de stockage = coût de la PROCHAINE amélioration de l'Hôtel de Ville
  // + 25%, arrondi à la centaine.
  const nextThCost = getBuildingUpgradeCost('town_hall', Math.max(1, townHallLevel));
  const caps = {} as any;
  for (const res of RESOURCES) {
    const need = nextThCost[res] || 0;
    // un minimum confortable pour les ressources peu/non demandées par l'HDV
    const withMargin = Math.max(need * 1.25, 2000);
    caps[res] = Math.ceil(withMargin / 100) * 100;
  }
  // L'or n'a plus de plafond de stockage.
  caps.gold = Number.MAX_SAFE_INTEGER;
  return caps;
}

// Calculate production per second for a building
export function calculateProduction(type: BuildingType, level: number, workers: number, tier: number): Record<ResourceType, number> {
  const config = BUILDINGS[type];
  const tierConfig = getTierConfig(tier);
  const levelBonus = 1 + (level - 1) * 0.25;
  const tierBonus = 1 + tierConfig.productionBonus;
  
  const production = {} as any;
  for (const res of RESOURCES) {
    production[res] = config.productionPerWorker[res] * workers * levelBonus * tierBonus;
  }
  return production;
}

// Calculate consumption per second for a building
export function calculateConsumption(type: BuildingType, level: number, workers: number): Record<ResourceType, number> {
  const config = BUILDINGS[type];
  const consumption = {} as any;
  for (const res of RESOURCES) {
    consumption[res] = (config.consumptionPerWorker[res] || 0) * workers;
  }
  return consumption;
}

// Calculate troop recruitment cost
export function getTroopCost(type: TroopType, count: number, existingCount: number): Record<ResourceType, number> {
  const config = TROOPS[type];
  const cost = {} as any;
  for (const res of RESOURCES) {
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(config.cost[res] * Math.pow(config.costMultiplier, Math.floor((existingCount + i) / 10)));
    }
    cost[res] = total;
  }
  return cost;
}

// ---- Amélioration des troupes par type ----
export const TROOP_MAX_LEVEL = 10;

// Stats d'une unité à un niveau donné : +12% par niveau au-dessus de 1.
export function troopStatsAtLevel(type: TroopType, level: number) {
  const t = TROOPS[type];
  const mult = 1 + (Math.max(1, level) - 1) * 0.12;
  return {
    attack: t.attack * mult,
    defense: t.defense * mult,
    hp: t.hp * mult,
    speed: t.speed,
  };
}

// Coût en or pour faire passer un type de troupe au niveau suivant.
export function getTroopUpgradeCost(type: TroopType, currentLevel: number): Record<ResourceType, number> {
  const t = TROOPS[type];
  const factor = Math.pow(1.8, currentLevel - 1);
  const base = (t.cost.stone + t.cost.iron + t.cost.gold + t.cost.wood + t.cost.magic_energy) * 1.5;
  return {
    stone: Math.floor(base * 0.4 * factor),
    iron: Math.floor(base * 0.4 * factor),
    gold: Math.floor((50 + base * 0.25) * factor),
    food: 0,
    wood: Math.floor(base * 0.2 * factor),
    magic_energy: Math.floor((t.cost.magic_energy + 10) * factor),
  };
}

// Puissance d'un contingent en tenant compte du niveau ET des atouts de rôle.
// Renvoie { power, healFactor } : healFactor augmente la survie de l'armée.
export function troopGroupPower(
  type: TroopType, count: number, level: number,
  ctx: { allyPower: number; enemyPower: number }
): { power: number; healFactor: number } {
  if (count <= 0 || !TROOPS[type]) return { power: 0, healFactor: 0 };
  const t = TROOPS[type];
  const s = troopStatsAtLevel(type, level);
  let power = (s.attack + s.defense + s.hp / 10) * count;
  let healFactor = 0;

  switch (t.role) {
    case 'tank':
      power += s.defense * count * 0.5; // bloc supplémentaire
      break;
    case 'ranged':
      power += s.attack * count * 0.3; // salve d'ouverture
      break;
    case 'mage':
      power += s.attack * count * 0.6; // perce l'armure
      break;
    case 'assassin':
      power += s.attack * count * 0.5; // exécution des fragiles
      break;
    case 'cavalry':
      // bonus seulement si l'armée domine déjà
      if (ctx.allyPower >= ctx.enemyPower) power += s.attack * count * 0.7;
      break;
    case 'healer':
      healFactor += 0.04 * count; // soin par soigneur
      break;
    case 'paladin':
      healFactor += 0.025 * count;
      power += s.defense * count * 0.3;
      break;
    default: // dps
      power += s.attack * count * 0.15;
  }
  return { power, healFactor };
}


export type ArmorSlot = 'helmet' | 'shoulders' | 'gloves' | 'chest' | 'boots' | 'shield' | 'bracers' | 'relic';

export interface ArmorTemplate {
  id: string;
  slot: ArmorSlot;
  name: string;
  icon: string;
  affinity: 'force' | 'garde' | 'vitalite' | 'arcane' | 'vitesse' | 'equilibre';
  baseEffects: Record<string, number>;
  bonus: string;
}

export const ARMOR_SLOT_NAMES: Record<ArmorSlot, string> = {
  helmet: 'Casque', shoulders: 'Épaulières', gloves: 'Gants', chest: 'Plastron',
  boots: 'Bottes', shield: 'Bouclier', bracers: 'Brassards', relic: 'Relique'
};

const ARMOR_SLOT_BY_COLUMN: ArmorSlot[] = [
  'helmet', 'helmet', 'shoulders', 'shoulders', 'gloves', 'gloves', 'chest', 'chest',
  'boots', 'boots', 'shield', 'shield', 'bracers', 'bracers', 'relic', 'relic'
];
const ARMOR_AFFIXES = [
  { key: 'iron', name: 'de Fer', affinity: 'garde', effects: { defense: 12, hp: 35 }, bonus: '+défense et +PV' },
  { key: 'lion', name: 'du Lion', affinity: 'force', effects: { attack: 16, defense: 4 }, bonus: '+attaque et parade' },
  { key: 'dragon', name: 'du Dragon', affinity: 'force', effects: { attack: 18, magic: 8 }, bonus: '+attaque et magie' },
  { key: 'warden', name: 'du Gardien', affinity: 'garde', effects: { defense: 18, hp: 45 }, bonus: '+résistance lourde' },
  { key: 'wind', name: 'du Vent', affinity: 'vitesse', effects: { speed: 9, attack: 7 }, bonus: '+vitesse et initiative' },
  { key: 'arcane', name: 'Arcanique', affinity: 'arcane', effects: { magic: 20, defense: 5 }, bonus: '+puissance magique' },
  { key: 'vital', name: 'de Vitalité', affinity: 'vitalite', effects: { hp: 85, defense: 5 }, bonus: '+gros bonus de PV' },
  { key: 'balanced', name: 'du Champion', affinity: 'equilibre', effects: { attack: 8, defense: 8, hp: 25, magic: 5 }, bonus: '+statistiques équilibrées' },
] as const;

export const ARMOR_TEMPLATES: ArmorTemplate[] = Array.from({ length: 128 }, (_, idx) => {
  const row = Math.floor(idx / 16) + 1;
  const col = (idx % 16) + 1;
  const slot = ARMOR_SLOT_BY_COLUMN[col - 1];
  const affix = ARMOR_AFFIXES[(row + col) % ARMOR_AFFIXES.length];
  const slotPower: Record<ArmorSlot, Record<string, number>> = {
    helmet: { magic: 4, defense: 6 }, shoulders: { defense: 10, hp: 25 }, gloves: { attack: 10, speed: 3 }, chest: { defense: 16, hp: 55 },
    boots: { speed: 8, hp: 18 }, shield: { defense: 18, hp: 35 }, bracers: { attack: 7, defense: 7 }, relic: { magic: 14, attack: 4 }
  };
  const effects: Record<string, number> = { ...slotPower[slot] };
  for (const [k, v] of Object.entries(affix.effects)) effects[k] = (effects[k] || 0) + v;
  return {
    id: `armor_${row}_${col}_${affix.key}`,
    slot,
    name: `${ARMOR_SLOT_NAMES[slot]} ${affix.name}`,
    icon: `/armor/armor_${row}_${col}.png`,
    affinity: affix.affinity as ArmorTemplate['affinity'],
    baseEffects: effects,
    bonus: `${ARMOR_SLOT_NAMES[slot]} ${affix.name} : ${affix.bonus}`,
  };
});

const RARITY_MULTIPLIER: Record<'rare' | 'epic' | 'legendary' | 'mythic' | 'supreme', number> = { rare: 1, epic: 1.55, legendary: 2.35, mythic: 5, supreme: 12 };
const RARITY_PREFIX: Record<'rare' | 'epic' | 'legendary' | 'mythic' | 'supreme', string> = { rare: 'Raffiné', epic: 'Épique', legendary: 'Légendaire', mythic: 'Mythique', supreme: 'Suprême' };

export function generateArmorDrop(floor: number, source: 'tower' | 'boss' | 'campaign' = 'tower', multiplier = 1): SpecialDrop {
  const power = Math.max(1, multiplier) * Math.max(1, floor);
  // Tirage des raretés ultra-rares en priorité :
  //   Suprême (rouge) : 0,1%  | Mythique (orange) : 1%.
  // Sinon, tirage classique rare / épique / légendaire.
  const ultraRoll = Math.random();
  let rarity: 'rare' | 'epic' | 'legendary' | 'mythic' | 'supreme';
  if (ultraRoll < 0.001) {
    rarity = 'supreme';
  } else if (ultraRoll < 0.011) {
    rarity = 'mythic';
  } else {
    const rarityRoll = Math.random() + Math.min(0.35, power / 220);
    rarity = rarityRoll > 0.92 ? 'legendary' : rarityRoll > 0.58 ? 'epic' : 'rare';
  }
  const candidates = ARMOR_TEMPLATES.filter((_, i) => (source === 'boss' ? i % 3 !== 1 : true));
  const template = candidates[Math.floor(Math.random() * candidates.length)];
  let scale = RARITY_MULTIPLIER[rarity] * (1 + Math.min(3.5, power / 90));
  const effects: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(template.baseEffects)) effects[k] = Math.max(1, Math.floor(v * scale));
  // Suprême : ajoute plusieurs milliers d'attaque et de PV. Mythique : gros bonus.
  if (rarity === 'supreme') {
    effects.attack = Math.floor(Number(effects.attack || 0)) + 3000 + Math.floor(power * 10);
    effects.hp = Math.floor(Number(effects.hp || 0)) + 5000 + Math.floor(power * 20);
    effects.defense = Math.floor(Number(effects.defense || 0)) + 1500;
    effects.magic = Math.floor(Number(effects.magic || 0)) + 1000;
    // Suprême : seul drop qui peut porter un multiplicateur de critique (+0,3 à +0,6).
    effects.crit_mult = Math.round((0.3 + Math.random() * 0.3) * 100) / 100;
  } else if (rarity === 'mythic') {
    effects.attack = Math.floor(Number(effects.attack || 0)) + 400 + Math.floor(power * 3);
    effects.hp = Math.floor(Number(effects.hp || 0)) + 800 + Math.floor(power * 5);
    effects.defense = Math.floor(Number(effects.defense || 0)) + 250;
  }
  effects.__icon = template.icon;
  effects.__slot = template.slot;
  effects.__set = `set_${rarity}`;
  effects.__bonus = `${template.bonus}. Multiplicateur x${multiplier} appliqué : statistiques x${scale.toFixed(2)}.`;
  effects.__source = source === 'boss' ? `Boss #${floor}` : source === 'tower' ? `Tour étage ${floor} x${multiplier}` : `Campagne ${floor}`;
  return {
    id: `${template.id}_${Date.now()}`,
    name: `${RARITY_PREFIX[rarity]} ${template.name} +${Math.floor(power)}`,
    rarity: rarity as any,
    itemType: `armor_${template.slot}`,
    effects: effects as Record<string, number>,
    icon: template.icon,
    slot: template.slot,
    bonusText: String(effects.__bonus),
  };
}

// ---- ARMURE GOD — créée via le craft (pas un drop). Stats colossales. ----
export function generateGodArmor(): SpecialDrop {
  const slot: ArmorSlot = 'chest';
  const effects: Record<string, number | string> = {
    attack: 25000, defense: 12000, hp: 50000, magic: 8000, speed: 200, crit: 100, crit_mult: 1.4,
  };
  effects.__icon = `/armor/armor_1_4.png`;
  effects.__slot = slot;
  effects.__bonus = `Armure GOD : la plus puissante du jeu, forgée par les dieux.`;
  effects.__source = 'Craft — GOD';
  return {
    id: `god_armor_${Date.now()}`,
    name: 'Armure GOD',
    rarity: 'god' as any,
    itemType: `armor_${slot}`,
    effects: effects as Record<string, number>,
    icon: `/armor/armor_1_4.png`,
    slot,
    bonusText: String(effects.__bonus),
  };
}

// ---- SET GOD COMPLET — 8 pièces (une par emplacement), créées au craft. ----
// Chaque pièce est colossale et porte __set 'set_god' (collection complète).
export const GOD_SET_SLOTS: ArmorSlot[] = ['helmet', 'shoulders', 'gloves', 'chest', 'boots', 'shield', 'bracers', 'relic'];
const GOD_SET_ICONS: Record<ArmorSlot, string> = {
  helmet: '/armor/armor_1_1.png', shoulders: '/armor/armor_1_2.png', gloves: '/armor/armor_1_3.png',
  chest: '/armor/armor_1_4.png', boots: '/armor/armor_1_5.png', shield: '/armor/armor_1_6.png',
  bracers: '/armor/armor_1_7.png', relic: '/armor/armor_1_8.png',
};
const GOD_SET_PIECE_NAMES: Record<ArmorSlot, string> = {
  helmet: 'Couronne des Dieux', shoulders: 'Épaulières des Dieux', gloves: 'Gantelets des Dieux',
  chest: 'Plastron des Dieux', boots: 'Bottes des Dieux', shield: 'Égide des Dieux',
  bracers: 'Brassards des Dieux', relic: 'Relique des Dieux',
};
// Statistiques par emplacement : chaque pièce est très puissante, avec un axe dominant.
const GOD_SET_STATS: Record<ArmorSlot, Record<string, number>> = {
  helmet:    { attack: 18000, defense: 14000, hp: 40000, magic: 12000, crit: 80 },
  shoulders: { attack: 16000, defense: 18000, hp: 45000, magic: 8000,  crit: 60 },
  gloves:    { attack: 28000, defense: 9000,  hp: 30000, magic: 9000,  crit: 120 },
  chest:     { attack: 25000, defense: 12000, hp: 50000, magic: 8000,  crit: 100 },
  boots:     { attack: 15000, defense: 10000, hp: 35000, magic: 7000,  speed: 250 },
  shield:    { attack: 8000,  defense: 30000, hp: 60000, magic: 6000,  crit: 40 },
  bracers:   { attack: 20000, defense: 13000, hp: 38000, magic: 11000, crit: 90 },
  relic:     { attack: 22000, defense: 11000, hp: 42000, magic: 20000, crit: 110 },
};
// Multiplicateur de critique par pièce (cumulé, le set complet ≈ ×2.5 plafond).
const GOD_SET_CRIT_MULT: Record<ArmorSlot, number> = {
  helmet: 0.15, shoulders: 0.15, gloves: 0.25, chest: 0.2, boots: 0.1, shield: 0.1, bracers: 0.2, relic: 0.25,
};
export function generateGodSetPiece(slot: ArmorSlot): SpecialDrop {
  const base = GOD_SET_STATS[slot];
  const effects: Record<string, number | string> = { ...base };
  effects.crit_mult = GOD_SET_CRIT_MULT[slot];
  effects.__icon = GOD_SET_ICONS[slot];
  effects.__slot = slot;
  effects.__set = 'set_god';
  effects.__bonus = `Pièce du Set GOD — ${ARMOR_SLOT_NAMES[slot]}. Collection complète : porte les 8 pièces pour le bonus de set.`;
  effects.__source = 'Craft — Set GOD';
  return {
    id: `god_set_${slot}_${Date.now()}`,
    name: GOD_SET_PIECE_NAMES[slot],
    rarity: 'god' as any,
    itemType: `armor_${slot}`,
    effects: effects as Record<string, number>,
    icon: GOD_SET_ICONS[slot],
    slot,
    bonusText: String(effects.__bonus),
  };
}

// Chaque boss (1..40) lâche SON objet propre. Doit rester synchronisé
// avec BOSS_ITEMS côté client (src/lib/gameData.ts) pour que l'info-bulle
// "drop %" affichée corresponde au drop réel.
const BOSS_ITEM_SLOTS: ArmorSlot[] = ['helmet', 'shoulders', 'gloves', 'chest', 'boots', 'shield', 'bracers', 'relic'];
const BOSS_ITEM_NAMES_SRV: string[] = [
  'Couronne du Roi Squelette', "Écaille de l'Hydre Ardente", "Aile de l'Archange Déchu", 'Tentacule Cauchemardesque', 'Cœur de Magma',
  'Croc du Dragon des Cendres', 'Poing du Colosse de Fer', 'Sceau du Seigneur Démon', 'Éclat de Glace Éternelle', 'Prisme Cristallin',
  'Dard de la Veuve Noire', 'Calice du Comte Vampire', 'Phylactère de la Liche', 'Œil du Kraken', 'Trident du Léviathan',
  'Braise du Vide', "Rouage de l'Automate", 'Ancre du Galion Maudit', 'Boussole Spectrale', 'Vrille Carnivore',
  'Épine de Manticore', "Écorce de l'Ent Gardien", 'Membrane de Chauve-Souris', 'Venin de Basilic', 'Anneau du Serpent Émeraude',
  'Énigme du Sphinx', 'Mèche de Gorgone', 'Regard Pétrifiant', 'Plume de Phénix', 'Idole de Cthulhu',
  'Croc de Gargouille', 'Serre du Griffon Royal', 'Givre du Titan', "Faux de l'Apocalypse", 'Fléau Visqueux',
  'Fragment du Néant', 'Carapace Cosmique', 'Vertèbre des Abysses', 'Fil de Cauchemar', 'Couronne du Dévoreur de Mondes',
];

export function bossSignatureDropChance(bossIndex: number): number {
  const i = bossIndex;
  const pct = i <= 8 ? 45 : i <= 18 ? 32 : i <= 28 ? 20 : i <= 36 ? 12 : 7;
  return pct / 100;
}

export function generateBossSignatureDrop(bossIndex: number): SpecialDrop {
  const i = Math.max(1, Math.min(40, bossIndex));
  const rarity: SpecialDrop['rarity'] = i <= 8 ? 'common' : i <= 18 ? 'rare' : i <= 28 ? 'epic' : 'legendary';
  const power = 4 + i * 2;
  const second = Math.round(power * 0.5);
  const statKeys = ['attack', 'defense', 'hp', 'magic', 'speed', 'crit'];
  const main = statKeys[(i - 1) % statKeys.length];
  const sec = statKeys[i % statKeys.length];
  const slot = BOSS_ITEM_SLOTS[(i - 1) % BOSS_ITEM_SLOTS.length];
  const icon = `/items/boss_item_${String(i).padStart(2, '0')}.png`;
  const effects: Record<string, number | string> = {};
  effects[main] = main === 'hp' ? power * 4 : power;
  if (sec !== main) effects[sec] = sec === 'hp' ? second * 4 : second;
  effects.__icon = icon;
  effects.__slot = slot;
  effects.__set = `set_${rarity}`;
  effects.__bonus = `Objet signature du boss #${i}.`;
  effects.__source = `Boss #${i}`;
  return {
    id: `boss_item_${i}_${Date.now()}`,
    name: BOSS_ITEM_NAMES_SRV[i - 1] || `Trophée du boss #${i}`,
    rarity,
    itemType: `armor_${slot}`,
    effects: effects as Record<string, number>,
    icon,
    slot,
    bonusText: String(effects.__bonus),
  };
}

// ---- Équipement fabriqué par la forge ----
// La rareté dépend du NIVEAU de la forge. Au niveau max (10), les chances sont :
//   Rare 65% · Épique 30% · Légendaire 4,9% · Mythique 0,1%.
// Aux niveaux inférieurs, la qualité est plus faible (plus de commun/rare).
export const FORGE_MAX_LEVEL = 10;
function forgeRarityRoll(forgeLevel: number): 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' {
  const lvl = Math.max(1, Math.min(FORGE_MAX_LEVEL, forgeLevel));
  const t = (lvl - 1) / (FORGE_MAX_LEVEL - 1); // 0 au niv.1 → 1 au niv.max
  // Interpolation entre niveau 1 (beaucoup de commun) et niveau max (cibles Julia).
  const mythic = 0.001 * t;                 // 0 → 0,1%
  const legendary = 0.049 * t;              // 0 → 4,9%
  const epic = 0.05 + (0.30 - 0.05) * t;    // 5% → 30%
  const rare = 0.30 + (0.65 - 0.30) * t;    // 30% → 65%
  // le reste = commun (niv.1 ≈ 65% commun, niv.max = 0%)
  const r = Math.random();
  if (r < mythic) return 'mythic';
  if (r < mythic + legendary) return 'legendary';
  if (r < mythic + legendary + epic) return 'epic';
  if (r < mythic + legendary + epic + rare) return 'rare';
  return 'common';
}

export function generateBasicEquipment(forgeLevel = 1): SpecialDrop {
  const slot = ARMOR_SLOT_BY_COLUMN[Math.floor(Math.random() * ARMOR_SLOT_BY_COLUMN.length)];
  const col = ARMOR_SLOT_BY_COLUMN.indexOf(slot) + 1;
  const rarity = forgeRarityRoll(forgeLevel);
  const RARITY_MULT: Record<string, number> = { common: 1, rare: 1.6, epic: 2.6, legendary: 4, mythic: 7 };
  const RARITY_PREFIX: Record<string, string> = { common: 'de fortune', rare: 'raffiné', epic: 'épique', legendary: 'légendaire', mythic: 'mythique' };
  const RARITY_ROW: Record<string, number> = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 4 };
  const row = RARITY_ROW[rarity];
  const slotPower: Record<ArmorSlot, Record<string, number>> = {
    helmet: { defense: 3, hp: 8 }, shoulders: { defense: 4, hp: 10 }, gloves: { attack: 4, speed: 1 },
    chest: { defense: 6, hp: 16 }, boots: { speed: 2, hp: 6 }, shield: { defense: 6, hp: 10 },
    bracers: { attack: 3, defense: 3 }, relic: { magic: 5, attack: 1 }
  };
  const bonusMult = (1 + (forgeLevel - 1) * 0.08) * RARITY_MULT[rarity];
  const effects: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(slotPower[slot])) effects[k] = Math.max(1, Math.floor(v * bonusMult));
  if (rarity === 'mythic') { effects.attack = Math.floor(Number(effects.attack || 0)) + 200; effects.hp = Math.floor(Number(effects.hp || 0)) + 400; }
  effects.__icon = `/armor/armor_${row}_${col}.png`;
  effects.__slot = slot;
  effects.__bonus = `Équipement ${RARITY_PREFIX[rarity]} forgé (forge niv. ${forgeLevel}).`;
  effects.__source = 'Forge';
  return {
    id: `forged_${slot}_${Date.now()}`,
    name: `${ARMOR_SLOT_NAMES[slot]} ${RARITY_PREFIX[rarity]}`,
    rarity: rarity as any,
    itemType: `armor_${slot}`,
    effects: effects as Record<string, number>,
    icon: `/armor/armor_${row}_${col}.png`,
    slot,
    bonusText: String(effects.__bonus),
  };
}

// Temps de forge (secondes) pour produire 1 équipement, selon le nombre d'ouvriers.
// Long par défaut ; chaque ouvrier accélère fortement.
export function forgeCraftSeconds(workers: number): number {
  if (workers <= 0) return Infinity; // sans ouvrier, rien ne se forge
  const base = 1800; // 30 min pour 1 ouvrier
  return Math.max(120, Math.floor(base / workers)); // plancher 2 min
}

// Hero XP needed for level
export function heroXpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}


// Hero stats per level
export function heroStatsForLevel(level: number): { attack: number; defense: number; hp: number; magic: number } {
  return {
    attack: 10 + level * 3,
    defense: 10 + level * 2,
    hp: 100 + level * 15,
    magic: 5 + level * 2
  };
}

// Hero skills
export interface HeroSkill {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  effectPerLevel: number;
  type: 'attack' | 'defense' | 'heal' | 'buff' | 'special';
}

export const HERO_SKILLS: HeroSkill[] = [
  { id: 'power_strike', name: 'Frappe puissante', description: 'Inflige des dégâts bonus à un ennemi', maxLevel: 40, effectPerLevel: 5, type: 'attack' },
  { id: 'iron_wall', name: 'Mur de fer', description: 'Augmente la défense de toutes les troupes', maxLevel: 40, effectPerLevel: 3, type: 'defense' },
  { id: 'heal_light', name: 'Lumière guérisseuse', description: 'Soigne un pourcentage des PV', maxLevel: 40, effectPerLevel: 2, type: 'heal' },
  { id: 'war_cry', name: 'Cri de guerre', description: 'Augmente l\'attaque de toutes les troupes', maxLevel: 40, effectPerLevel: 3, type: 'buff' },
  { id: 'arcane_blast', name: 'Déflagration arcanique', description: 'Dégâts magiques de zone', maxLevel: 40, effectPerLevel: 8, type: 'special' },
  { id: 'shield_bash', name: 'Coup de bouclier', description: 'Étourdit un ennemi', maxLevel: 20, effectPerLevel: 10, type: 'attack' },
  { id: 'regeneration', name: 'Régénération', description: 'Régénère les PV chaque tour', maxLevel: 40, effectPerLevel: 1, type: 'heal' },
  { id: 'berserker', name: 'Berserker', description: 'Plus de dégâts quand PV bas', maxLevel: 20, effectPerLevel: 5, type: 'buff' }
];

// Campaign chapter and episode configurations
export const CAMPAIGN_CHAPTERS = 10;
export const CAMPAIGN_EPISODES_PER_CHAPTER = 10;
export const CAMPAIGN_TOTAL = CAMPAIGN_CHAPTERS * CAMPAIGN_EPISODES_PER_CHAPTER;

export interface CampaignLevel {
  chapter: number;
  episode: number;
  enemyTroops: { type: TroopType; count: number }[];
  enemyHero: { level: number; attack: number; defense: number; hp: number };
  rewards: Record<ResourceType, number>;
  renownReward: number;
  isBoss: boolean;
}

// ============================================================
// CONFIGURATION DE DIFFICULTÉ — réglable depuis le panneau admin.
// Toutes les valeurs ci-dessous pilotent campagne / tour / boss.
// ============================================================
export interface DifficultyConfig {
  tower: {
    multScalePerMult: number;   // pente de difficulté par cran de multiplicateur (0.6 = +60%)
    statBoostPerMult: number;   // bonus de stats du héros ennemi par cran de multiplicateur
    troopBase: number;          // base du nombre d'ennemis
    troopPerDiff: number;       // ennemis par point de difficulté
    heroLevelPerFloor: number;  // niveau du héros ennemi par étage
    rewardBase: number;
    rewardPerDiff: number;
    allowedMultipliers: number[]; // multiplicateurs proposés au joueur
    resetMinFloor: number;        // étage minimum après un reset
  };
  campaign: {
    curveBase: number;          // base exponentielle de montée (1.10)
    bossMultiplier: number;     // dureté des boss de chapitre
    troopBase: number;
    troopPerDiff: number;
    heroLevelPerDiff: number;
    rewardBase: number;
    rewardPerDiff: number;
  };
  boss: {
    curveExp: number;           // exposant de la courbe (1.35)
    curveMul: number;           // facteur de la courbe (1.8)
    partyScalePerPlayer: number;
    troopBase: number;
    troopPerDiff: number;
    heroLevelPerIndex: number;
    bossMulBase: number;        // multiplicateur de stats de base (1.3)
    bossMulPerIndex: number;    // + par index (0.08)
    rewardBase: number;
    rewardPerDiff: number;
  };
}

export const DEFAULT_DIFFICULTY: DifficultyConfig = {
  tower: {
    multScalePerMult: 1.1, statBoostPerMult: 0.5, troopBase: 4, troopPerDiff: 0.7,
    heroLevelPerFloor: 1.8, rewardBase: 80, rewardPerDiff: 45,
    allowedMultipliers: [1, 2, 3, 5, 10, 15, 25], resetMinFloor: 10,
  },
  campaign: {
    curveBase: 1.10, bossMultiplier: 1.6, troopBase: 3, troopPerDiff: 0.6,
    heroLevelPerDiff: 1.5, rewardBase: 120, rewardPerDiff: 45,
  },
  boss: {
    curveExp: 1.35, curveMul: 1.8, partyScalePerPlayer: 0.6, troopBase: 6, troopPerDiff: 1.0,
    heroLevelPerIndex: 4, bossMulBase: 1.3, bossMulPerIndex: 0.08, rewardBase: 300, rewardPerDiff: 110,
  },
};

let DIFFICULTY: DifficultyConfig = JSON.parse(JSON.stringify(DEFAULT_DIFFICULTY));

export function getDifficulty(): DifficultyConfig { return DIFFICULTY; }
export function setDifficulty(partial: any): DifficultyConfig {
  // fusion profonde et tolérante (ignore les clés inconnues / valeurs invalides)
  const merge = (base: any, over: any) => {
    if (!over || typeof over !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (over[k] === undefined || over[k] === null) continue;
      if (Array.isArray(base[k])) {
        if (Array.isArray(over[k])) base[k] = over[k].map((n: any) => Number(n)).filter((n: number) => isFinite(n) && n > 0);
      } else if (typeof base[k] === 'object') {
        merge(base[k], over[k]);
      } else if (typeof base[k] === 'number') {
        const v = Number(over[k]);
        if (isFinite(v)) base[k] = v;
      }
    }
    return base;
  };
  merge(DIFFICULTY, partial);
  return DIFFICULTY;
}
export function resetDifficulty(): DifficultyConfig {
  DIFFICULTY = JSON.parse(JSON.stringify(DEFAULT_DIFFICULTY));
  return DIFFICULTY;
}

// Generate campaign level dynamically
export function generateCampaignLevel(chapter: number, episode: number): CampaignLevel {
  const difficulty = (chapter - 1) * 10 + episode;
  const isBoss = episode === 10;
  const C = DIFFICULTY.campaign;
  const multiplier = isBoss ? C.bossMultiplier : 1;
  const curve = Math.pow(C.curveBase, difficulty - 1);

  const availableTroops = TROOP_TYPES.filter(t => {
    const tierNeeded = TROOPS[t].minTier;
    return tierNeeded <= Math.ceil(chapter / 2);
  });

  const enemyTroops = availableTroops.map(type => ({
    type,
    count: Math.floor((C.troopBase + difficulty * C.troopPerDiff) * curve * multiplier)
  }));

  const heroLevel = Math.max(1, Math.floor(difficulty * C.heroLevelPerDiff * (isBoss ? 1.2 : 1)));
  const heroStats = heroStatsForLevel(heroLevel);

  const rewards = {} as any;
  for (const res of RESOURCES) {
    rewards[res] = Math.floor((C.rewardBase + difficulty * C.rewardPerDiff) * multiplier);
  }

  return {
    chapter,
    episode,
    enemyTroops,
    enemyHero: { level: heroLevel, ...heroStats },
    rewards,
    renownReward: Math.floor((20 + difficulty * 9) * multiplier),
    isBoss
  };
}

// Tower floor generation (procedural)
export function generateTowerFloor(floor: number, multiplier: number): CampaignLevel {
  const chapter = Math.ceil(floor / 10);
  const episode = ((floor - 1) % 10) + 1;
  const T = DIFFICULTY.tower;

  const multScale = 1 + (multiplier - 1) * T.multScalePerMult;
  const difficulty = floor * multScale;

  const availableTroops = TROOP_TYPES.filter(t => TROOPS[t].minTier <= Math.ceil(floor / 5));

  const enemyTroops = availableTroops.map(type => ({
    type,
    count: Math.floor((T.troopBase + difficulty * T.troopPerDiff) * multScale)
  }));

  const heroLevel = Math.max(1, Math.floor(floor * T.heroLevelPerFloor * multScale));
  const baseStats = heroStatsForLevel(heroLevel);
  const statBoost = 1 + (multiplier - 1) * T.statBoostPerMult;
  const heroStats = {
    attack: Math.floor(baseStats.attack * statBoost),
    defense: Math.floor(baseStats.defense * statBoost),
    hp: Math.floor(baseStats.hp * statBoost),
    magic: Math.floor(baseStats.magic * statBoost),
  };

  const rewards = {} as any;
  for (const res of RESOURCES) {
    rewards[res] = Math.floor((T.rewardBase + difficulty * T.rewardPerDiff) * multiplier);
  }

  return {
    chapter: chapter || 1,
    episode: episode || 1,
    enemyTroops,
    enemyHero: { level: heroLevel, ...heroStats },
    rewards,
    renownReward: Math.floor((12 + floor * 5) * multiplier),
    isBoss: floor % 10 === 0
  };
}

// ---- BOSS GAUNTLET: 40 escalating bosses ----
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

export function generateBoss(index: number, partySize = 1, bossMultiplier = 1): CampaignLevel & { bossName: string; bossIndex: number; bossMultiplier: number } {
  const i = Math.max(1, Math.min(40, index));
  const mult = Math.max(1, Math.floor(bossMultiplier || 1));
  const B = DIFFICULTY.boss;
  const difficulty = Math.pow(i, B.curveExp) * B.curveMul;
  const partyScale = 1 + (partySize - 1) * B.partyScalePerPlayer;

  const availableTroops = TROOP_TYPES.filter(t => TROOPS[t].minTier <= Math.ceil(i / 4) + 1);
  // Multiplicateur de boss : combattre N fois le même boss en UN combat.
  // Les effectifs ennemis sont multipliés par N.
  const enemyTroops = availableTroops.map(type => ({
    type,
    count: Math.floor((B.troopBase + difficulty * B.troopPerDiff) * partyScale) * mult
  }));

  const heroLevel = Math.max(3, Math.floor(i * B.heroLevelPerIndex));
  const base = heroStatsForLevel(heroLevel);
  const bossMul = B.bossMulBase + i * B.bossMulPerIndex;
  // Les stats du boss sont multipliées par N (ex. 1000 PV en x5 → 5000 PV).
  const heroStats = {
    attack: Math.floor(base.attack * bossMul * partyScale) * mult,
    defense: Math.floor(base.defense * bossMul * partyScale) * mult,
    hp: Math.floor(base.hp * bossMul * partyScale) * mult,
    magic: Math.floor(base.magic * bossMul * partyScale) * mult,
  };

  const rewards = {} as any;
  // Récompenses multipliées par N puisque l'on bat N boss d'un coup.
  for (const res of RESOURCES) rewards[res] = Math.floor(B.rewardBase + difficulty * B.rewardPerDiff) * mult;

  return {
    chapter: 1, episode: i,
    enemyTroops,
    enemyHero: { level: heroLevel, ...heroStats },
    rewards,
    renownReward: Math.floor(70 + i * 28) * mult,
    isBoss: true,
    bossName: BOSS_NAMES[i - 1] || `Boss ${i}`,
    bossIndex: i,
    bossMultiplier: mult,
  } as any;
}

// Resolve a battle for a PARTY: pool every member's troops, take the best
// hero stats across the party (with a small per-extra-member bonus).
export function resolvePartyCombat(
  members: { troops: Record<string, number>; hero: { attack: number; defense: number; hp: number; magic: number; level: number } }[],
  enemyTroops: { type: TroopType; count: number }[],
  enemyHero: { level: number; attack: number; defense: number; hp: number },
  rewards: Record<ResourceType, number>,
  renownReward: number,
  floor: number,
  override?: { victory: boolean } | null
) {
  // pool troops
  const pooled: Record<string, number> = {};
  for (const m of members)
    for (const [t, c] of Object.entries(m.troops)) pooled[t] = (pooled[t] || 0) + c;

  // combined hero = strongest member + bonus per extra member
  const sorted = [...members].sort((a, b) =>
    (b.hero.attack + b.hero.defense + b.hero.hp) - (a.hero.attack + a.hero.defense + a.hero.hp));
  const lead = sorted[0].hero;
  const bonus = 1 + (members.length - 1) * 0.25;
  const combinedHero = {
    attack: lead.attack * bonus, defense: lead.defense * bonus,
    hp: lead.hp * bonus, magic: lead.magic * bonus, level: lead.level,
  };

  const result = resolveCombat(pooled, combinedHero, enemyTroops, enemyHero, rewards, renownReward, floor, 'tower', 1, {}, override || null);

  // distribute surviving troops proportionally back to each member
  const perMemberSurvivors = members.map(m => {
    const surv: Record<string, number> = {};
    for (const [t, c] of Object.entries(m.troops)) {
      const pool = pooled[t] || 1;
      const ratio = (result.survivingTroops[t] || 0) / pool;
      surv[t] = Math.floor(c * ratio);
    }
    return surv;
  });

  return { result, perMemberSurvivors };
}

// Combat resolution
export interface CombatResult {
  victory: boolean;
  survivingTroops: Record<TroopType, number>;
  troopsSent?: Record<string, number>;
  troopsLost?: Record<string, number>;
  enemyComposition?: { type: string; count: number }[];
  enemyTotal?: number;
  enemyKilled?: number;
  heroHpRemaining: number;
  resourcesGained: Record<ResourceType, number>;
  renownGained: number;
  specialDrop: SpecialDrop | null;
  xpGained: number;
}

export interface SpecialDrop {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'supreme' | 'god';
  effects: Record<string, number>;
  itemType?: string;
  icon?: string;
  slot?: ArmorSlot;
  bonusText?: string;
}

export const SPECIAL_DROPS: SpecialDrop[] = [
  { id: 'crown_of_flames', name: 'Couronne de flammes', rarity: 'rare', effects: { attack: 15, magic: 10 } },
  { id: 'iron_bark_shield', name: 'Bouclier d\'écorce de fer', rarity: 'rare', effects: { defense: 20, hp: 50 } },
  { id: 'shadow_cloak', name: 'Cape de l\'ombre', rarity: 'epic', effects: { speed: 10, attack: 20 } },
  { id: 'dragons_heart', name: 'Coeur de dragon', rarity: 'epic', effects: { hp: 200, attack: 25 } },
  { id: 'celestial_blade', name: 'Lame céleste', rarity: 'legendary', effects: { attack: 50, magic: 30, speed: 15 } },
  { id: 'ancient_tome', name: 'Grimoire ancien', rarity: 'legendary', effects: { magic: 50, defense: 30 } },
  { id: 'phoenix_feather', name: 'Plume de phoenix', rarity: 'rare', effects: { hp: 100, magic: 15 } },
  { id: 'void_gauntlet', name: 'Gantelet du vide', rarity: 'epic', effects: { attack: 35, speed: 5 } },
  { id: 'eternal_crown', name: 'Couronne éternelle', rarity: 'legendary', effects: { attack: 40, defense: 40, hp: 150 } },
  { id: 'moonstone_amulet', name: 'Amulette de pierre de lune', rarity: 'rare', effects: { magic: 25, hp: 75 } },
];

export function resolveCombat(
  playerTroops: Record<string, number>,
  playerHero: { attack: number; defense: number; hp: number; magic: number; level: number },
  enemyTroops: { type: TroopType; count: number }[],
  enemyHero: { level: number; attack: number; defense: number; hp: number },
  rewards: Record<ResourceType, number>,
  renownReward: number,
  floor: number,
  dropSource: 'tower' | 'boss' | 'campaign' = 'tower',
  dropMultiplier = 1,
  troopLevels: Record<string, number> = {},
  override?: { victory: boolean; survivingTroops?: Record<string, number> } | null,
  bossSignature?: { bossIndex: number } | null,
  dropChanceMult = 1
): CombatResult {
  // Calculate total army power
  let playerPower = playerHero.attack + playerHero.defense + playerHero.hp / 5 + playerHero.magic * 2;
  let enemyPower = enemyHero.attack + enemyHero.defense + enemyHero.hp / 5 + enemyHero.level * 3;

  // Puissance ennemie d'abord (niveau 1, sans rôle) pour servir de contexte.
  for (const troop of enemyTroops) {
    const t = TROOPS[troop.type];
    enemyPower += (t.attack + t.defense + t.hp / 10) * troop.count;
  }

  // Puissance du joueur avec niveaux + atouts de rôle, et soin cumulé des soigneurs.
  let healFactor = 0;
  for (const [type, count] of Object.entries(playerTroops)) {
    if (count > 0 && TROOPS[type as TroopType]) {
      const lvl = troopLevels[type] || 1;
      const g = troopGroupPower(type as TroopType, count, lvl, { allyPower: playerPower, enemyPower });
      playerPower += g.power;
      healFactor += g.healFactor;
    }
  }
  healFactor = Math.min(0.35, healFactor); // plafond du soin

  // Combat ratio determines outcome
  const ratio = playerPower / (playerPower + enemyPower);
  // Si le client a simulé le combat tour par tour, on respecte son verdict.
  const victory = override ? override.victory : ratio > 0.35 + Math.random() * 0.15;

  // Calculate surviving troops (les soigneurs augmentent le taux de survie)
  const baseSurvival = victory ? Math.min(0.95, ratio * 1.2) : Math.max(0.05, ratio * 0.3);
  const survivalRate = Math.min(0.99, baseSurvival + healFactor);
  const survivingTroops: Record<string, number> = {};
  for (const [type, count] of Object.entries(playerTroops)) {
    if (override && override.survivingTroops && override.survivingTroops[type] != null) {
      survivingTroops[type] = Math.max(0, Math.min(count, Math.floor(override.survivingTroops[type])));
    } else {
      survivingTroops[type] = Math.max(0, Math.floor(count * survivalRate));
    }
  }

  const heroHpRemaining = victory
    ? Math.floor(playerHero.hp * Math.min(0.99, ratio * 1.1 + healFactor))
    : Math.floor(playerHero.hp * Math.max(0.05, ratio * 0.2 + healFactor * 0.5));

  // Armor drop chance: boss/tower/campaign can drop equipable champion armor.
  let specialDrop: SpecialDrop | null = null;
  if (bossSignature && victory) {
    // Boss : son objet signature, à sa propre chance de drop (× le buff éventuel).
    const bossChance = Math.min(0.98, bossSignatureDropChance(bossSignature.bossIndex) * dropChanceMult);
    if (Math.random() < bossChance) {
      specialDrop = generateBossSignatureDrop(bossSignature.bossIndex);
    }
  } else {
    const dropChance = victory ? Math.min(0.98, (0.30 + floor * 0.01) * dropChanceMult) : 0.05;
    if (Math.random() < dropChance) {
      specialDrop = generateArmorDrop(floor, dropSource, dropMultiplier);
    }
  }

  const xpGained = victory ? Math.floor(40 + floor * 16) : Math.floor(10 + floor * 4);

  // Détails pour l'animation de combat (pertes en direct, ennemis tués).
  const troopsLost: Record<string, number> = {};
  for (const [type, count] of Object.entries(playerTroops)) {
    troopsLost[type] = Math.max(0, count - (survivingTroops[type] || 0));
  }
  const totalEnemies = enemyTroops.reduce((s, e) => s + e.count, 0);
  // Si victoire : tous tués. Sinon : proportion battue selon le ratio.
  const enemyKilled = victory ? totalEnemies : Math.floor(totalEnemies * Math.min(0.9, ratio));

  return {
    victory,
    survivingTroops,
    troopsSent: { ...playerTroops },
    troopsLost,
    enemyComposition: enemyTroops.map(e => ({ type: e.type, count: e.count })),
    enemyTotal: totalEnemies,
    enemyKilled,
    heroHpRemaining,
    resourcesGained: victory ? rewards : { stone: 0, iron: 0, gold: 0, food: 0, wood: 0, magic_energy: 0 },
    renownGained: victory ? renownReward : Math.floor(renownReward * 0.1),
    specialDrop,
    xpGained
  };
}

// Prestige bonuses
export interface PrestigeBonus {
  productionMultiplier: number;
  startingResources: Record<ResourceType, number>;
  troopBonus: number;
  heroBonus: number;
}

export function getPrestigeBonuses(prestigeCount: number): PrestigeBonus {
  return {
    productionMultiplier: 1 + prestigeCount * 0.1,
    startingResources: {
      stone: 500 + prestigeCount * 200,
      iron: 300 + prestigeCount * 150,
      gold: 200 + prestigeCount * 100,
      food: 400 + prestigeCount * 200,
      wood: 600 + prestigeCount * 250,
      magic_energy: 100 + prestigeCount * 50
    },
    troopBonus: prestigeCount * 0.05,
    heroBonus: prestigeCount * 0.03
  };
}

// Research types
export interface ResearchConfig {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  costMultiplier: number;
  baseCost: Record<ResourceType, number>;
  effectPerLevel: string;
  baseTime: number; // seconds
}

export const RESEARCH_TYPES: ResearchConfig[] = [
  { id: 'mining_efficiency', name: 'Efficacité minière', description: 'Augmente la production des mines', maxLevel: 20, costMultiplier: 1.5, baseCost: { stone: 200, iron: 100, gold: 50, food: 0, wood: 50, magic_energy: 10 }, effectPerLevel: '+5% production', baseTime: 3600 },
  { id: 'farming_techniques', name: 'Techniques agricoles', description: 'Augmente la production des fermes', maxLevel: 20, costMultiplier: 1.5, baseCost: { stone: 50, iron: 30, gold: 40, food: 0, wood: 200, magic_energy: 5 }, effectPerLevel: '+5% production', baseTime: 3600 },
  { id: 'forging_mastery', name: 'Maîtrise de la forge', description: 'Améliore la qualité des équipements', maxLevel: 15, costMultiplier: 1.6, baseCost: { stone: 100, iron: 200, gold: 80, food: 0, wood: 50, magic_energy: 20 }, effectPerLevel: '+3% qualité', baseTime: 7200 },
  { id: 'military_tactics', name: 'Tactiques militaires', description: 'Améliore les troupes au combat', maxLevel: 20, costMultiplier: 1.5, baseCost: { stone: 150, iron: 150, gold: 100, food: 100, wood: 50, magic_energy: 30 }, effectPerLevel: '+2% combat', baseTime: 5400 },
  { id: 'arcane_studies', name: 'Études arcaniques', description: 'Augmente la production magique', maxLevel: 20, costMultiplier: 1.6, baseCost: { stone: 100, iron: 50, gold: 150, food: 0, wood: 100, magic_energy: 100 }, effectPerLevel: '+5% magie', baseTime: 5400 },
  { id: 'fortification', name: 'Fortification', description: 'Renforce les défenses du village', maxLevel: 15, costMultiplier: 1.5, baseCost: { stone: 300, iron: 200, gold: 50, food: 0, wood: 200, magic_energy: 10 }, effectPerLevel: '+5% défense', baseTime: 7200 },
];

// Raid cost and mechanics
export const RAID_COST: Record<ResourceType, number> = { stone: 200, iron: 150, gold: 100, food: 100, wood: 100, magic_energy: 20 };
export const RAID_DEFENSE_BONUS = 0.2; // defender gets 20% bonus

// Market fee
export const MARKET_FEE = 0.1; // 10% fee on transactions

// Prix fixes de vente automatique des ressources au marché.
// L'or n'est pas vendable ici, car toutes les ventes de ressources donnent de l'or.
export const RESOURCE_SELL_PRICES: Partial<Record<ResourceType, number>> = {
  stone: 1,
  wood: 1,
  food: 2,
  iron: 4,
  magic_energy: 8,
};

// Seasonal event types
export const EVENT_TYPES = [
  { id: 'resource_frenzy', name: 'Folie des ressources', description: 'Production doublée pendant l\'événement' },
  { id: 'dragon_invasion', name: 'Invasion de dragons', description: 'Combattez des dragons pour des récompenses épiques' },
  { id: 'tournament', name: 'Tournoi des champions', description: 'Compétition PvP pour la gloire' },
  { id: 'harvest_festival', name: 'Festival de la moisson', description: 'Récoltes exceptionnelles' },
  { id: 'arcane_eclipse', name: 'Éclipse arcanique', description: 'Énergie magique décuplée' }
];
