'use client';

import { create } from 'zustand';

export interface GameState {
  connected: boolean;
  authenticated: boolean;
  player: {
    id: string;
    username: string;
    renown: number;
    prestige_count: number;
    prestige_bonuses: string;
  } | null;
  village: {
    id: string;
    player_id: string;
    name: string;
    tier: number;
    town_hall_level: number;
  } | null;
  resources: Record<string, number> | null;
  buildings: any[];
  troops: any[];
  hero: any;
  inventory: any[];
  campaign: { chapter: number; episode: number };
  tower: { current_floor: number; best_floor: number };
  boss: { highest_boss: number };
  partyRoom: any;
  research: any[];
  prestigeBonus: any;
  tierConfig: any;
  workers: { pool: number; used: number; available: number; cap: number; nextCost: number } | null;
  // UI State
  currentTab: string;
  notifications: any[];
  chatMessages: any[];
  friends: any[];
  friendsVersion: number;
  leaderboard: any[];
  marketListings: any[];
  onlinePlayers: any[];
  seasonalEvents: any[];
  combatResult: any;
  pendingBattle: any;
  coopBattle: any;
  duelInvite: any;
  partyInvite: any;
  // Actions
  setState: (state: Partial<GameState>) => void;
  setFullState: (state: any) => void;
  setCurrentTab: (tab: string) => void;
  addNotification: (n: any) => void;
  addChatMessage: (msg: any) => void;
  setChatMessages: (msgs: any[]) => void;
  setFriends: (friends: any[]) => void;
  bumpFriendsVersion: () => void;
  setLeaderboard: (lb: any[]) => void;
  setMarketListings: (listings: any[]) => void;
  setOnlinePlayers: (players: any[]) => void;
  setSeasonalEvents: (events: any[]) => void;
  setCombatResult: (result: any) => void;
  clearCombatResult: () => void;
  setPartyRoom: (room: any) => void;
  setCoopBattle: (b: any) => void;
  setDuelInvite: (d: any) => void;
  logout: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  authenticated: false,
  player: null,
  village: null,
  resources: null,
  buildings: [],
  troops: [],
  hero: null,
  inventory: [],
  campaign: { chapter: 1, episode: 1 },
  tower: { current_floor: 0, best_floor: 0 },
  boss: { highest_boss: 0 },
  partyRoom: null,
  research: [],
  prestigeBonus: null,
  tierConfig: null,
  workers: null,
  currentTab: 'village',
  notifications: [],
  chatMessages: [],
  friends: [],
  friendsVersion: 0,
  leaderboard: [],
  marketListings: [],
  onlinePlayers: [],
  seasonalEvents: [],
  combatResult: null,
  pendingBattle: null,
  coopBattle: null,
  duelInvite: null,
  partyInvite: null,
  setState: (state) => set(state),
  setFullState: (s) => set({
    player: s.player,
    village: s.village,
    resources: s.resources,
    buildings: s.buildings || [],
    troops: s.troops || [],
    hero: s.hero,
    inventory: s.inventory || [],
    campaign: s.campaign || { chapter: 1, episode: 1 },
    tower: s.tower || { current_floor: 0, best_floor: 0 },
    towerMultipliers: s.towerMultipliers || [1, 2, 3, 5, 10, 15, 25],
    boss: s.boss || { highest_boss: 0 },
    research: s.research || [],
    prestigeBonus: s.prestigeBonus,
    tierConfig: s.tierConfig,
    workers: s.workers || null,
    activeBuffMults: s.activeBuffMults || {},
    disabledTabs: s.disabledTabs || [],
    authenticated: true,
  }),
  setCurrentTab: (tab) => set({ currentTab: tab }),
  addNotification: (n) => set((state) => ({
    notifications: [...state.notifications.slice(-19), { ...n, id: Date.now() + Math.random(), time: new Date().toLocaleTimeString() }]
  })),
  addChatMessage: (msg) => set((state) => {
    // Évite les doublons (même id déjà présent).
    if (msg?.id != null && state.chatMessages.some((m: any) => m.id === msg.id)) return {};
    return { chatMessages: [...state.chatMessages.slice(-99), msg] };
  }),
  setChatMessages: (msgs) => set({ chatMessages: (msgs || []).slice(-100) }),
  setFriends: (friends) => set({ friends }),
  bumpFriendsVersion: () => set((s) => ({ friendsVersion: s.friendsVersion + 1 })),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setMarketListings: (marketListings) => set({ marketListings }),
  setOnlinePlayers: (onlinePlayers) => set({ onlinePlayers }),
  setSeasonalEvents: (seasonalEvents) => set({ seasonalEvents }),
  setCombatResult: (result) => set({ combatResult: result }),
  clearCombatResult: () => set({ combatResult: null }),
  setPartyRoom: (room) => set({ partyRoom: room }),
  setCoopBattle: (b) => set({ coopBattle: b }),
  setDuelInvite: (d) => set({ duelInvite: d }),
  setPartyInvite: (d) => set({ partyInvite: d }),
  logout: () => {
    if (typeof window !== 'undefined') localStorage.removeItem('rdl_token');
    set({
      authenticated: false,
      player: null,
      village: null,
      resources: null,
      buildings: [],
      troops: [],
      hero: null,
      inventory: [],
      currentTab: 'village',
    });
  },
}));

// Game constants matching server
export const RESOURCE_NAMES: Record<string, string> = {
  stone: 'Pierre',
  iron: 'Fer',
  gold: 'Or',
  food: 'Nourriture',
  wood: 'Bois',
  magic_energy: 'Énergie magique'
};

export const RESOURCE_ICONS: Record<string, string> = {
  stone: '🪨',
  iron: '⛏️',
  gold: '🪙',
  food: '🌾',
  wood: '🪵',
  magic_energy: '✨'
};

export const BUILDING_NAMES: Record<string, string> = {
  mine: 'Mine',
  lumberjack: 'Bûcheron',
  farm: 'Ferme',
  forge: 'Forge',
  barracks: 'Caserne',
  library: 'Bibliothèque',
  sanctuary: 'Sanctuaire',
  town_hall: 'Hôtel de Ville'
};

export const BUILDING_ICONS: Record<string, string> = {
  mine: '⛏️',
  lumberjack: '🪓',
  farm: '🌾',
  forge: '🔥',
  barracks: '⚔️',
  library: '📚',
  sanctuary: '🏛️',
  town_hall: '🏰'
};

export const TROOP_NAMES: Record<string, string> = {
  soldier: 'Prince',
  archer: 'Elfe',
  knight: 'Nain',
  mage_guard: 'Cowboy',
  golem: 'Golem',
  dragon_rider: 'Chevaucheur de dragon',
  shadow_assassin: 'Assassin de l\'ombre',
  holy_paladin: 'Prêtre'
};

export const TROOP_ICONS: Record<string, string> = {
  soldier: '🤴',
  archer: '🧝',
  knight: '🧔',
  mage_guard: '🤠',
  golem: '🗿',
  dragon_rider: '🐉',
  shadow_assassin: '🌑',
  holy_paladin: '🙏'
};

export const BUILDING_DESC: Record<string, string> = {
  mine: 'Les mineurs extraient la pierre et le fer.',
  lumberjack: 'Les bûcherons coupent du bois pour les constructions et améliorations.',
  farm: 'Les fermiers produisent la nourriture du village.',
  forge: 'Les forgerons transforment les ressources en armures et équipements.',
  barracks: 'La caserne permet de recruter et entraîner des troupes.',
  library: 'La bibliothèque entraîne le héros : +0,5 XP par ouvrier toutes les 5 min.',
  sanctuary: 'Le sanctuaire génère de l\'Énergie magique pour vos recherches.',
  town_hall: 'L\'Hôtel de Ville détermine le palier du village et débloque de nouvelles constructions.'
};

// Production / consommation par ouvrier (miroir du serveur), pour les info-bulles.
export const BUILDING_PROD: Record<string, { prod: Record<string, number>; cons: Record<string, number> }> = {
  mine: { prod: { stone: 2.5, iron: 1.85 }, cons: { food: 0.5 } },
  lumberjack: { prod: { wood: 3.0 }, cons: { food: 0.4 } },
  farm: { prod: { food: 3.0 }, cons: {} },
  forge: { prod: {}, cons: { iron: 2.0, stone: 1.0, food: 0.5 } },
  barracks: { prod: {}, cons: { food: 1.0 } },
  library: { prod: {}, cons: { gold: 0.5, magic_energy: 0.2 } },
  sanctuary: { prod: { magic_energy: 2.0 }, cons: { gold: 0.3, food: 0.3 } },
  town_hall: { prod: {}, cons: {} }
};

export const RARITY_COLORS: Record<string, string> = {
  common: 'text-gray-400',
  rare: 'text-blue-400',
  epic: 'text-purple-400',
  legendary: 'text-amber-400',
  mythic: 'text-orange-400',
  supreme: 'text-red-500',
  god: 'text-yellow-300'
};

export const RARITY_BG: Record<string, string> = {
  common: 'border-gray-600',
  rare: 'border-blue-500',
  epic: 'border-purple-500',
  legendary: 'border-amber-500',
  mythic: 'border-orange-500',
  supreme: 'border-red-500',
  god: 'border-yellow-300'
};
