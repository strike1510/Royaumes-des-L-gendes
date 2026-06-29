'use client';

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore, RESOURCE_NAMES, RESOURCE_ICONS, BUILDING_NAMES, BUILDING_ICONS, BUILDING_DESC, BUILDING_PROD, TROOP_NAMES, TROOP_ICONS, RARITY_COLORS, RARITY_BG } from '@/lib/gameStore';
import { BattleArena, SpriteAnimation } from '@/components/BattleArena';
import { TurnBattle } from '@/components/TurnBattle';
import { CoopBattle } from '@/components/CoopBattle';
import { initCombat, SKILL_BY_ID } from '@/lib/combatEngine';
import { TroopRecruiter } from '@/components/TroopRecruiter';
import { TROOP_DATA, ROLE_INFO, TROOP_MAX_LEVEL, troopStatsAtLevel, computeTroopUpgradeCost, BOSS_NAMES, bossDifficultyLabel, bossItem, type BossItem, campaignBossItemIcon, campaignBossItemName } from '@/lib/gameData';


const UPGRADE_RESOURCES = ['stone', 'iron', 'gold', 'food', 'wood', 'magic_energy'];

const RESOURCE_SELL_PRICES: Record<string, number> = {
  stone: 1,
  wood: 1,
  food: 2,
  iron: 4,
  magic_energy: 8,
};
const SELLABLE_RESOURCES = ['stone', 'wood', 'food', 'iron', 'magic_energy'];

const BUILDING_UPGRADE_DATA: Record<string, { baseCost: Record<string, number>; costMultiplier: number }> = {
  mine: { baseCost: { stone: 100, iron: 50, gold: 30, food: 0, wood: 80, magic_energy: 0 }, costMultiplier: 1.5 },
  lumberjack: { baseCost: { stone: 70, iron: 25, gold: 10, food: 0, wood: 40, magic_energy: 0 }, costMultiplier: 1.45 },
  farm: { baseCost: { stone: 60, iron: 20, gold: 10, food: 0, wood: 100, magic_energy: 0 }, costMultiplier: 1.4 },
  forge: { baseCost: { stone: 150, iron: 100, gold: 50, food: 0, wood: 50, magic_energy: 10 }, costMultiplier: 1.6 },
  barracks: { baseCost: { stone: 200, iron: 150, gold: 80, food: 0, wood: 100, magic_energy: 20 }, costMultiplier: 1.7 },
  library: { baseCost: { stone: 200, iron: 50, gold: 100, food: 0, wood: 150, magic_energy: 50 }, costMultiplier: 1.8 },
  sanctuary: { baseCost: { stone: 300, iron: 100, gold: 150, food: 0, wood: 200, magic_energy: 100 }, costMultiplier: 1.8 },
  town_hall: { baseCost: { stone: 500, iron: 300, gold: 200, food: 100, wood: 400, magic_energy: 50 }, costMultiplier: 2.0 },
};

function getClientBuildingUpgradeCost(type: string, currentLevel: number): Record<string, number> {
  const config = BUILDING_UPGRADE_DATA[type] || BUILDING_UPGRADE_DATA.mine;
  return Object.fromEntries(
    UPGRADE_RESOURCES.map((res) => [
      res,
      Math.floor((config.baseCost[res] || 0) * Math.pow(config.costMultiplier, currentLevel || 0)),
    ])
  );
}

// ============================================================
// MAIN GAME COMPONENT
// ============================================================
export default function GamePage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [unreadChat, setUnreadChat] = useState(false);
  const [adminAlert, setAdminAlert] = useState<{ message: string; ts: number } | null>(null);
  const currentTabRef = useRef('village');

  const {
    authenticated, player, village, resources, buildings, troops, hero, inventory,
    campaign, tower, research, prestigeBonus, tierConfig, currentTab, notifications,
    chatMessages, friends, leaderboard, marketListings, onlinePlayers, seasonalEvents,
    combatResult, pendingBattle, coopBattle, duelInvite, partyInvite,
    setFullState, setCurrentTab, addNotification, addChatMessage, setFriends,
    setLeaderboard, setMarketListings, setOnlinePlayers, setSeasonalEvents,
    setCombatResult, clearCombatResult, setDuelInvite, setPartyInvite, logout
  } = useGameStore();

  // Connect socket
  const socketRef = useRef<Socket | null>(null);
  
  useEffect(() => {
    // En production avec Cloudflare Tunnel, le navigateur ne doit PAS viser
    // directement un port public. Il parle uniquement à
    // l'origine du site, ex. https://play.lavignere.eu/socket.io.
    //
    // Sans NEXT_PUBLIC_GAME_SERVER_URL, Socket.IO utilise automatiquement le
    // même domaine/protocole que la page. Next/Caddy/cloudflared relaie ensuite
    // /socket.io vers le serveur de jeu local sur 50007.
    const configuredGameServerUrl = process.env.NEXT_PUBLIC_GAME_SERVER_URL?.trim();
    const socketUrl = configuredGameServerUrl || undefined;

    const s = io(socketUrl, {
      // polling d'abord : il aboutit même quand l'upgrade WebSocket direct est
      // filtré par un réseau/wifi, puis Socket.IO tente l'upgrade tout seul.
      transports: ['polling', 'websocket'],
      path: '/socket.io',
      timeout: 8000,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = s;
    if (typeof window !== 'undefined') (window as any).__gameSocket = s;

    s.on('connect', () => {
      useGameStore.setState({ connected: true });
      setServerStatus('online');
      console.log('Connected to game server');
      // Reconnexion auto via token (valide 1h).
      const token = typeof window !== 'undefined' ? localStorage.getItem('rdl_token') : null;
      if (token && !useGameStore.getState().authenticated) {
        s.emit('resume_session', { token }, (res: any) => {
          if (res?.success) {
            if (res.token) localStorage.setItem('rdl_token', res.token);
            setFullState(res.state);
          } else {
            localStorage.removeItem('rdl_token');
          }
        });
      }
    });

    s.on('disconnect', () => {
      useGameStore.setState({ connected: false });
      setServerStatus('offline');
    });

    s.on('connect_error', (err) => {
      console.warn('Connexion au serveur de jeu impossible:', socketUrl || window.location.origin, err?.message);
      setServerStatus('offline');
    });

    // Si toutes les tentatives de reconnexion échouent, on passe définitivement
    // en mode hors ligne plutôt que de laisser l'écran tourner indéfiniment.
    s.io.on('reconnect_failed', () => {
      console.warn('Échec de toutes les reconnexions au serveur de jeu.');
      setServerStatus('offline');
    });

    s.on('notification', (n) => addNotification(n));
    s.on('chat_message', (msg) => {
      addChatMessage(msg);
      if (currentTabRef.current !== 'chat') setUnreadChat(true);
    });
    s.on('friend_online', (d) => { useGameStore.getState().bumpFriendsVersion(); addNotification({ type: 'friend_online', message: `${d.username} est en ligne !` }); });
    s.on('friend_offline', (d) => { useGameStore.getState().bumpFriendsVersion(); addNotification({ type: 'friend_offline', message: `${d.username} s'est déconnecté` }); });
    s.on('friend_request', (d) => { useGameStore.getState().bumpFriendsVersion(); addNotification({ type: 'friend_request', message: `Demande d'ami de ${d.username} !` }); });
    s.on('friend_accepted', (d) => { useGameStore.getState().bumpFriendsVersion(); addNotification({ type: 'friend_online', message: `${d.username} a accepté votre demande !` }); });
    s.on('friend_removed', () => { useGameStore.getState().bumpFriendsVersion(); });

    // Alerte admin : popup central temporaire + message spécial dans le tchat.
    s.on('admin_alert', (d: { message: string; ts: number }) => {
      setAdminAlert({ message: d.message, ts: d.ts });
      setTimeout(() => setAdminAlert(prev => (prev && prev.ts === d.ts ? null : prev)), 8000);
      addChatMessage({ id: `alert_${d.ts}`, username: '📢 ALERTE', message: d.message, channel: 'global', timestamp: Math.floor(d.ts / 1000), isAdminAlert: true });
      if (currentTabRef.current !== 'chat') setUnreadChat(true);
    });

    // Multiplayer party + pushed state updates
    s.on('state_update', (st) => { if (st) setFullState(st); });
    s.on('party_update', (data) => {
      if (data?.closed) { useGameStore.getState().setPartyRoom(null); return; }
      useGameStore.getState().setPartyRoom(data);
    });
    // Combat coop : le serveur signale le début → on ouvre l'arène partagée.
    s.on('coop_begin', (info: { scene: 'forest' | 'tower'; bossIndex: number | null; mode: string }) => {
      const roomId = useGameStore.getState().partyRoom?.roomId;
      if (typeof window !== 'undefined') (window as any).__coopRoomId = roomId;
      useGameStore.getState().setCoopBattle({
        scene: info.scene,
        bossIndex: info.bossIndex,
        bossImage: info.bossIndex ? `/bosses/boss_${info.bossIndex}.png` : null,
        allyTypes: [...new Set(useGameStore.getState().troops.map((t: any) => t.type))],
      });
    });
    s.on('party_result', (payload) => {
      // Le combat coop est terminé côté serveur (récompenses appliquées).
      // On ferme l'arène coop pour tout le monde et on montre le récap.
      useGameStore.getState().setCombatResult({
        ...payload.result,
        allyTypes: [],
        bossName: payload.bossName,
        isParty: true,
        partySize: payload.partySize,
        multiplier: payload.multiplier,
        climbing: payload.climbing,
        nextTarget: payload.nextTarget,
        floor: payload.mode === 'tower' ? payload.target : undefined,
      });
      if (payload.climbing) {
        useGameStore.getState().addNotification({
          type: 'success',
          message: `🗼 Étage ${payload.target} franchi en équipe ! Préparez vos troupes pour l'étage ${payload.nextTarget}.`,
        });
      }
    });

    // ---- INVITATIONS DE GROUPE (COOP) ----
    s.on('party_invite', (d: { roomId: string; mode: string; host: string; expiresIn: number }) => {
      useGameStore.getState().setPartyInvite({ ...d, received: Date.now() });
      addNotification({ type: 'friend_request', message: `👥 ${d.host} t'invite dans un groupe !` });
    });
    s.on('party_invite_declined', (d: { name: string }) => {
      addNotification({ type: 'error', message: `${d.name} a refusé l'invitation.` });
    });
    s.on('party_kicked', () => {
      useGameStore.getState().setPartyRoom(null);
      useGameStore.getState().setCoopBattle(null);
      addNotification({ type: 'error', message: 'Tu as été retiré du groupe par l\'hôte.' });
    });

    // ---- DUELS 1v1 ----
    s.on('duel_invite', (d: { duelId: string; challenger: string; stake: number }) => {
      useGameStore.getState().setDuelInvite(d);
      addNotification({ type: 'friend_request', message: `⚔️ ${d.challenger} te défie en duel (mise ${d.stake}) !` });
    });
    s.on('duel_result', (d: any) => {
      if (d?.declined) { addNotification({ type: 'error', message: `${d.by} a refusé le duel.` }); return; }
      if (d?.cancelled) { addNotification({ type: 'error', message: 'Duel annulé (renommée insuffisante).' }); return; }
      const me = useGameStore.getState().player?.username;
      const won = d.winner === me;
      addNotification({ type: won ? 'success' : 'error', message: won ? `⚔️ Duel gagné ! +${d.stake} renommée.` : `⚔️ Duel perdu contre ${d.winner}. -${d.stake} renommée.` });
    });

    // Check server status after timeout
    setTimeout(() => {
      if (!s.connected) {
        console.warn('Serveur de jeu non joignable sur', socketUrl || window.location.origin);
        setServerStatus('offline');
      }
    }, 3500);

    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    currentTabRef.current = currentTab;
    if (currentTab === 'chat') setUnreadChat(false);
  }, [currentTab]);

  // L'admin par défaut démarre sur l'onglet Admin, mais peut naviguer partout pour tester.
  const [adminDefaulted, setAdminDefaulted] = useState(false);
  useEffect(() => {
    if (player?.isAdmin && !adminDefaulted) { setCurrentTab('admin'); setAdminDefaulted(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.isAdmin]);

  // Si l'onglet courant a été désactivé par l'admin, on renvoie sur le Village.
  const disabledTabs = (useGameStore() as any).disabledTabs || [];
  useEffect(() => {
    if (!player?.isAdmin && disabledTabs.includes(currentTab)) setCurrentTab('village');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabledTabs, currentTab, player?.isAdmin]);

  // Auto-refresh state every 5s
  useEffect(() => {
    if (!authenticated || !socketRef.current) return;
    const interval = setInterval(() => {
      socketRef.current?.emit('get_state', {}, (res: any) => {
        if (res.success) setFullState(res.state);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [authenticated]);

  // Plein écran auto au premier geste après connexion.
  // Les navigateurs interdisent le plein écran sans interaction, donc on
  // l'attache au premier clic/touche puis on se retire.
  useEffect(() => {
    if (!authenticated) return;
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) return;

    const goFullscreen = () => {
      const el: any = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) {
        try {
          const p = req.call(el);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {}
      }
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('click', goFullscreen);
      window.removeEventListener('keydown', goFullscreen);
      window.removeEventListener('touchstart', goFullscreen);
    };
    window.addEventListener('click', goFullscreen);
    window.addEventListener('keydown', goFullscreen);
    window.addEventListener('touchstart', goFullscreen);
    return cleanup;
  }, [authenticated]);

  // Login handler
  const handleLogin = () => {
    if (!username.trim() || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }
    setLoading(true);
    setError('');

    if (!socketRef.current || !socketRef.current.connected) {
      // Offline mode - use demo data
      setTimeout(() => {
        setFullState({
          player: { id: 'demo-1', username: username.trim(), renown: 100, prestige_count: 1, prestige_bonuses: '{}' },
          village: { id: 'v-1', player_id: 'demo-1', name: `Château ${username.trim()}`, tier: 2, town_hall_level: 3 },
          resources: { stone: 500, iron: 300, gold: 150, food: 800, wood: 600, magic_energy: 50, max_stone: 7500, max_iron: 7500, max_gold: 7500, max_food: 7500, max_wood: 7500, max_magic_energy: 3000 },
          buildings: [
            { id: 'b1', village_id: 'v-1', type: 'town_hall', level: 3, workers_assigned: 0, max_workers: 0 },
            { id: 'b2', village_id: 'v-1', type: 'mine', level: 2, workers_assigned: 5, max_workers: 7 },
            { id: 'b3', village_id: 'v-1', type: 'lumberjack', level: 1, workers_assigned: 3, max_workers: 5 },
            { id: 'b4', village_id: 'v-1', type: 'farm', level: 2, workers_assigned: 4, max_workers: 7 },
            { id: 'b5', village_id: 'v-1', type: 'farm', level: 1, workers_assigned: 3, max_workers: 6 },
            { id: 'b6', village_id: 'v-1', type: 'forge', level: 1, workers_assigned: 2, max_workers: 5 },
            { id: 'b7', village_id: 'v-1', type: 'barracks', level: 1, workers_assigned: 2, max_workers: 5 },
          ],
          troops: [
            { id: 't1', village_id: 'v-1', type: 'soldier', count: 10, level: 3 },
            { id: 't2', village_id: 'v-1', type: 'archer', count: 5, level: 2 },
            { id: 't3', village_id: 'v-1', type: 'holy_paladin', count: 2, level: 1 }
          ],
          hero: { id: 'h1', player_id: 'demo-1', name: 'Héros', level: 3, xp: 45, skill_points: 2, skills: '{}', attack: 19, defense: 16, hp: 145, magic: 11 },
          inventory: [],
          campaign: { chapter: 1, episode: 1 },
          tower: { current_floor: 0, best_floor: 0 },
          research: [],
          prestigeBonus: { productionMultiplier: 1.1, startingResources: { stone: 700, iron: 450, gold: 300, food: 600, wood: 850, magic_energy: 150 }, troopBonus: 0.05, heroBonus: 0.03 },
          tierConfig: {
            tier: 2, townHallLevel: 3,
            maxBuildings: { mine: 2, lumberjack: 2, farm: 3, forge: 1, barracks: 2, library: 0, sanctuary: 0, town_hall: 1 },
            resourceCapMultiplier: 1.5, productionBonus: 0.1,
            unlockTroops: ['soldier', 'archer'],
            unlockBuildings: ['mine', 'lumberjack', 'farm', 'forge', 'barracks', 'town_hall']
          },
          workers: { pool: 25, used: 19, available: 6, cap: 16, nextCost: 234 },
        });
        setLoading(false);
      }, 800);
      return;
    }

    socketRef.current.emit('login', { username: username.trim(), password }, (res: any) => {
      setLoading(false);
      if (res.success) {
        if (res.token) localStorage.setItem('rdl_token', res.token);
        setFullState(res.state);
      } else {
        setError(res.error);
      }
    });
  };

  // Register handler
  const handleRegister = () => {
    if (!username.trim() || username.trim().length < 2) {
      setError('Le nom doit contenir au moins 2 caractères');
      return;
    }
    if (!password || password.length < 3) {
      setError('Le mot de passe doit contenir au moins 3 caractères');
      return;
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    setError('');

    if (!socketRef.current || !socketRef.current.connected) {
      setError('Serveur hors ligne. Impossible de créer un compte.');
      setLoading(false);
      return;
    }

    socketRef.current.emit('register', { username: username.trim(), password }, (res: any) => {
      setLoading(false);
      if (res.success) {
        if (res.token) localStorage.setItem('rdl_token', res.token);
        setFullState(res.state);
      } else {
        setError(res.error);
      }
    });
  };

  // Socket emit helper
  const emit = (event: string, data: any, callback?: (res: any) => void) => {
    if (!socketRef.current) return;
    socketRef.current.emit(event, data, (res: any) => {
      if (res.success && res.state) setFullState(res.state);
      callback?.(res);
    });
  };

  // ============================================================
  // LOGIN SCREEN
  // ============================================================
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#1a0a2e] via-[#2d1b4e] to-[#0d0520] relative overflow-hidden">
        {/* Animated stars background */}
        <div className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 50 }).map((_, i) => {
            const pseudoLeft = ((i * 73 + 37) % 100);
            const pseudoTop = ((i * 59 + 23) % 100);
            const pseudoDelay = ((i * 41 + 7) % 30) / 10;
            const pseudoDuration = 1 + ((i * 29 + 13) % 20) / 10;
            return (
              <div key={i} className="absolute w-1 h-1 bg-yellow-200 rounded-full animate-pulse"
                style={{
                  left: `${pseudoLeft}%`,
                  top: `${pseudoTop}%`,
                  animationDelay: `${pseudoDelay}s`,
                  animationDuration: `${pseudoDuration}s`
                }} />
            );
          })}
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          {/* Castle & Title */}
          <div className="text-center mb-6">
            <div className="text-6xl mb-4 animate-bounce" style={{ animationDuration: '3s' }}>🏰</div>
            <h1 className="text-4xl font-bold text-amber-400 tracking-wider" style={{ fontFamily: 'serif', textShadow: '0 0 20px rgba(217, 164, 65, 0.5)' }}>
              Royaumes de Légende
            </h1>
            <p className="text-amber-200/70 mt-2 text-sm tracking-widest uppercase">Construisez. Conquérez. Régnez.</p>
          </div>

          {/* Server status indicator */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className={`w-2.5 h-2.5 rounded-full ${
              serverStatus === 'online' ? 'bg-green-400 shadow-green-400/50 shadow-sm' :
              serverStatus === 'offline' ? 'bg-red-400 shadow-red-400/50 shadow-sm' :
              'bg-yellow-400 animate-pulse'
            }`} />
            <span className="text-xs text-amber-200/50">
              {serverStatus === 'online' ? 'Serveur connecté' :
               serverStatus === 'offline' ? 'Serveur hors ligne (mode démo)' :
               'Connexion au serveur...'}
            </span>
          </div>

          {/* Auth Card */}
          <div className="bg-[#1a0a2e]/80 backdrop-blur-xl border border-amber-500/30 rounded-2xl shadow-2xl shadow-amber-900/20 overflow-hidden">
            {/* Login / Register tabs */}
            <div className="flex border-b border-amber-500/20">
              <button
                onClick={() => { setAuthMode('login'); setError(''); }}
                className={`flex-1 py-3 text-sm font-bold tracking-wider transition-all ${
                  authMode === 'login'
                    ? 'bg-amber-500/20 text-amber-300 border-b-2 border-amber-400'
                    : 'text-amber-500/50 hover:text-amber-300 hover:bg-amber-500/5'
                }`}
              >
                ⚔️ Connexion
              </button>
              <button
                onClick={() => { setAuthMode('register'); setError(''); }}
                className={`flex-1 py-3 text-sm font-bold tracking-wider transition-all ${
                  authMode === 'register'
                    ? 'bg-amber-500/20 text-amber-300 border-b-2 border-amber-400'
                    : 'text-amber-500/50 hover:text-amber-300 hover:bg-amber-500/5'
                }`}
              >
                🛡️ Créer un compte
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Username */}
              <div>
                <label className="text-amber-300 text-sm font-medium mb-1.5 block">
                  {authMode === 'login' ? '👤 Nom du Seigneur' : '👤 Choisissez un nom'}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())}
                  className="w-full bg-[#0d0520] border border-amber-500/30 rounded-lg px-4 py-3 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-all"
                  placeholder={authMode === 'login' ? 'Votre nom de seigneur...' : 'Au moins 2 caractères...'}
                  autoComplete="username"
                />
              </div>

              {/* Password */}
              <div>
                <label className="text-amber-300 text-sm font-medium mb-1.5 block">
                  🔒 Mot de passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (authMode === 'login' ? handleLogin() : handleRegister())}
                  className="w-full bg-[#0d0520] border border-amber-500/30 rounded-lg px-4 py-3 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-all"
                  placeholder={authMode === 'login' ? 'Votre mot de passe...' : 'Au moins 3 caractères...'}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>

              {/* Confirm Password (register only) */}
              {authMode === 'register' && (
                <div>
                  <label className="text-amber-300 text-sm font-medium mb-1.5 block">
                    🔒 Confirmer le mot de passe
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                    className="w-full bg-[#0d0520] border border-amber-500/30 rounded-lg px-4 py-3 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-all"
                    placeholder="Retapez votre mot de passe..."
                    autoComplete="new-password"
                  />
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="bg-red-900/50 border border-red-500/50 rounded-lg px-4 py-2.5 text-red-300 text-sm flex items-center gap-2">
                  <span>⚠️</span> {error}
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={authMode === 'login' ? handleLogin : handleRegister}
                disabled={loading || !username.trim() || !password}
                className={`w-full font-bold py-3 rounded-lg transition-all duration-200 shadow-lg text-lg tracking-wider disabled:opacity-50 disabled:cursor-not-allowed ${
                  authMode === 'login'
                    ? 'bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-100 shadow-amber-900/50'
                    : 'bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-emerald-100 shadow-emerald-900/50'
                }`}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    {authMode === 'login' ? 'Connexion...' : 'Création...'}
                  </span>
                ) : (
                  authMode === 'login' ? '⚔️ Se connecter' : '🛡️ Créer mon royaume'
                )}
              </button>

              {/* Bottom hint */}
              {authMode === 'login' ? (
                <p className="text-amber-500/50 text-xs text-center">
                  Pas encore de compte ?{' '}
                  <button onClick={() => { setAuthMode('register'); setError(''); }} className="text-amber-400 hover:text-amber-300 underline">
                    Créer un royaume
                  </button>
                </p>
              ) : (
                <p className="text-amber-500/50 text-xs text-center">
                  Déjà un compte ?{' '}
                  <button onClick={() => { setAuthMode('login'); setError(''); }} className="text-amber-400 hover:text-amber-300 underline">
                    Se connecter
                  </button>
                </p>
              )}

              {serverStatus === 'offline' && authMode === 'login' && (
                <p className="text-amber-500/40 text-xs text-center border-t border-amber-500/10 pt-3 mt-2">
                  💡 Serveur hors ligne : le mode démo sera activé avec des données exemple.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // GAME UI
  // ============================================================
  const resKeys = ['stone', 'iron', 'gold', 'food', 'wood', 'magic_energy'];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a0a2e] via-[#2d1b4e] to-[#0d0520] text-amber-100 flex flex-col">
      {/* ====== TOP BAR ====== */}
      <header className="bg-[#0d0520]/90 border-b border-amber-500/30 px-4 py-2 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          {/* Player info */}
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏰</span>
            <div>
              <div className="font-bold text-amber-400 text-sm">{player?.username}</div>
              <div className="text-xs text-amber-200/50">HDV {village?.town_hall_level} | Prestige {player?.prestige_count}</div>
            </div>
            <button
              onClick={() => {
                const el: any = document.documentElement;
                try {
                  if (document.fullscreenElement) {
                    const p = document.exitFullscreen?.();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                  } else {
                    const req = el.requestFullscreen || el.webkitRequestFullscreen;
                    const p = req?.call(el);
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                  }
                } catch {}
              }}
              title="Plein écran"
              className="text-amber-300/70 hover:text-amber-300 text-lg px-2 py-1 rounded hover:bg-amber-500/10 transition-all">
              ⛶
            </button>
          </div>

          {/* Resource bar */}
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {resKeys.map(res => (
              <div key={res} className="flex items-center gap-1 bg-[#1a0a2e]/80 rounded-lg px-2 py-1 border border-amber-500/20 text-xs">
                <span>{RESOURCE_ICONS[res]}</span>
                <span className="text-amber-200">{Math.floor(resources?.[res] || 0)}</span>
                {res !== 'gold' && <span className="text-amber-500/40 hidden sm:inline">/ {Math.floor(resources?.[`max_${res}`] || 0)}</span>}
              </div>
            ))}
          </div>

          {/* Renown */}
          <div className="flex items-center gap-2 bg-[#1a0a2e]/80 rounded-lg px-3 py-1 border border-amber-400/30">
            <span className="text-yellow-400">🏆</span>
            <span className="text-amber-300 font-bold">{player?.renown || 0}</span>
            <span className="text-amber-500/50 text-xs">Renommée</span>
          </div>
        </div>
      </header>

      {/* ====== NAVIGATION TABS ====== */}
      <nav className="bg-[#0d0520]/80 border-b border-amber-500/20 px-2 py-2 sticky top-[52px] z-40 backdrop-blur-md">
        <div className="flex flex-wrap gap-1.5">
          {(() => {
            const gameTabs = [
            { id: 'village', label: '🏘️ Village', },
            { id: 'troops', label: '⚔️ Troupes', },
            { id: 'hero', label: '🦸 Héros', },
            { id: 'campaign', label: '📜 Campagne', },
            { id: 'dungeon', label: '🗝️ Donjons', },
            { id: 'bosses', label: '👹 Boss', },
            { id: 'tower', label: '🗼 Tour', },
            { id: 'market', label: '🏪 Marché', },
            { id: 'research', label: '🔬 Recherche', },
            { id: 'craft', label: '⚒️ Craft' },
            { id: 'friends', label: '👥 Amis', },
            { id: 'chat', label: '💬 Tchat', },
            { id: 'leaderboard', label: '🏆 Classement', },
            { id: 'prestige', label: '✨ Prestige', },
            { id: 'events', label: '🎉 Événements', },
            ];
            const disabled = (useGameStore.getState() as any).disabledTabs || [];
            // Admin : accès à TOUT (même onglets désactivés) + onglet Admin.
            const list = player?.isAdmin
              ? [...gameTabs, { id: 'admin', label: '🛡️ Admin' }]
              : gameTabs.filter((tab) => !disabled.includes(tab.id));
            return list;
          })().map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setCurrentTab(tab.id);
                if (tab.id === 'chat') setUnreadChat(false);
              }}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all border ${
                tab.id === 'chat' && unreadChat && currentTab !== 'chat'
                  ? 'bg-red-600/30 text-red-200 border-red-400 shadow-lg shadow-red-900/30 animate-pulse'
                  : currentTab === tab.id
                    ? 'bg-gradient-to-b from-amber-500/30 to-amber-600/20 text-amber-200 border-amber-400/60 shadow-md shadow-amber-900/20'
                    : 'text-amber-300/60 border-transparent hover:text-amber-200 hover:bg-amber-500/10 hover:border-amber-500/20'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ====== MAIN CONTENT ====== */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4">
        {player?.isAdmin ? (
          <AdminTab emit={emit} />
        ) : (
          <>
        {currentTab === 'village' && <VillageTab emit={emit} />}
        {currentTab === 'troops' && <TroopsTab emit={emit} />}
        {currentTab === 'hero' && <HeroTab emit={emit} />}
        {currentTab === 'campaign' && <CampaignTab emit={emit} />}
        {currentTab === 'dungeon' && <DungeonTab emit={emit} />}
        {currentTab === 'bosses' && <BossTab emit={emit} />}
        {currentTab === 'tower' && <TowerTab emit={emit} />}
        {currentTab === 'market' && <MarketTab emit={emit} />}
        {currentTab === 'raid' && null}
        {currentTab === 'research' && <ResearchTab emit={emit} />}
        {currentTab === 'craft' && <CraftTab emit={emit} />}
        {currentTab === 'friends' && <FriendsTab emit={emit} />}
        {currentTab === 'chat' && <ChatTab emit={emit} />}
        {currentTab === 'leaderboard' && <LeaderboardTab emit={emit} />}
        {currentTab === 'prestige' && <PrestigeTab emit={emit} />}
        {currentTab === 'events' && <EventsTab emit={emit} />}
        {currentTab === 'admin' && player?.isAdmin && <AdminTab emit={emit} />}
          </>
        )}
      </main>

      {/* ====== NOTIFICATIONS ====== */}
      <NotificationPanel />

      {/* Alerte admin : bandeau central temporaire */}
      {adminAlert && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none px-4">
          <div className="pointer-events-auto max-w-xl w-full bg-gradient-to-br from-red-900/95 to-purple-900/95 border-2 border-red-400 rounded-2xl shadow-2xl shadow-red-900/50 px-8 py-6 text-center animate-pulse">
            <div className="text-red-300 text-xs font-bold tracking-widest mb-2">📢 ANNONCE</div>
            <div className="text-white text-xl sm:text-2xl font-extrabold leading-snug">{adminAlert.message}</div>
            <button onClick={() => setAdminAlert(null)} className="mt-4 text-red-200/70 hover:text-white text-xs font-bold">Fermer</button>
          </div>
        </div>
      )}

      {/* ====== INVITATION DE DUEL ====== */}
      {duelInvite && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
          <div className="max-w-sm w-full bg-gradient-to-br from-[#2a1535] to-[#1a0a2e] border-2 border-amber-400 rounded-2xl shadow-2xl px-6 py-6 text-center">
            <div className="text-3xl mb-2">⚔️</div>
            <div className="text-amber-300 font-extrabold text-lg mb-1">Défi en duel !</div>
            <div className="text-amber-100/80 text-sm mb-4">
              <span className="font-bold text-amber-200">{duelInvite.challenger}</span> te défie en 1 contre 1.<br />
              Mise : <span className="font-bold text-amber-200">{duelInvite.stake} renommée</span>.<br />
              <span className="text-amber-200/50 text-xs">Le gagnant remporte les 2 mises. Aucune autre récompense.</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { emit('duel_respond', { duelId: duelInvite.duelId, accept: true }, () => {}); setDuelInvite(null); }}
                className="flex-1 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-50">
                Accepter
              </button>
              <button onClick={() => { emit('duel_respond', { duelId: duelInvite.duelId, accept: false }, () => {}); setDuelInvite(null); }}
                className="flex-1 py-2 rounded-lg text-sm font-bold bg-black/30 border border-amber-500/30 text-amber-200/70 hover:text-amber-100">
                Refuser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== INVITATION DE GROUPE (COOP) ====== */}
      {partyInvite && <PartyInviteModal invite={partyInvite} emit={emit} onClose={() => setPartyInvite(null)} />}

      {/* ====== COMBAT TOUR PAR TOUR (interactif) ====== */}
      {pendingBattle && (
        <TurnBattle
          initialState={pendingBattle.state}
          scene={pendingBattle.scene}
          allyTypes={pendingBattle.allyTypes || []}
          bossImage={pendingBattle.bossIndex ? `/bosses/boss_${pendingBattle.bossIndex}.png` : null}
          enemyFrames={pendingBattle.enemyFrames ?? null}
          chapter={pendingBattle.chapter ?? null}
          isBoss={pendingBattle.isBoss ?? false}
          towerFloor={pendingBattle.towerFloor ?? null}
          meta={{ originalTroops: pendingBattle.originalTroops }}
          applyResult={(outcome) => new Promise((resolve) => {
            const pb = pendingBattle;
            emit(pb.applyEvent, { ...pb.applyData, clientResult: outcome }, (res: any) => {
              if (!res?.success) {
                useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
                resolve(null);
                return;
              }
              if (pb.onApplied) pb.onApplied(res);
              // Renvoie le résumé de butin à afficher dans le coffre, sur place.
              resolve(res.result ? { ...res.result, floor: res.floor ?? pb.floor, bossName: res.bossName } : null);
            });
          })}
          onDone={() => { useGameStore.setState({ pendingBattle: null }); }}
        />
      )}

      {/* ====== COMBAT COOP TOUR PAR TOUR (multijoueur) ====== */}
      {coopBattle && player && (
        <CoopBattle
          emit={emit}
          myPlayerId={player.id}
          scene={coopBattle.scene}
          bossImage={coopBattle.bossImage}
          allyTypes={coopBattle.allyTypes || []}
          onDone={() => { useGameStore.getState().setCoopBattle(null); }}
        />
      )}

      {/* ====== COMBAT ====== */}
      {combatResult && (combatResult.scene
        ? <BattleArena scene={combatResult.scene} allyTypes={combatResult.allyTypes || []} result={combatResult}
            bossImage={combatResult.bossIndex ? `/bosses/boss_${combatResult.bossIndex}.png` : null}
            onClose={() => { clearCombatResult(); useGameStore.getState().setCoopBattle(null); }} />
        : <CombatResultModal result={combatResult} onClose={() => { clearCombatResult(); useGameStore.getState().setCoopBattle(null); }} />)}
    </div>
  );
}

// ============================================================
// VILLAGE TAB
// ============================================================
function VillageTab({ emit }: { emit: (event: string, data: any, callback?: (res: any) => void) => void }) {
  const { village, buildings, resources, tierConfig, workers, activeBuffMults } = useGameStore() as any;
  const prodBoost = (activeBuffMults?.production_boost) || 1;
  const [buildingNew, setBuildingNew] = useState<string | null>(null);

  if (!village || !resources) return <LoadingSpinner />;

  const buildingTypes = ['mine', 'lumberjack', 'farm', 'forge', 'library', 'sanctuary'];

  return (
    <div className="space-y-6">
      {/* Village Header */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold text-amber-400" style={{ fontFamily: 'serif' }}>
              🏰 {village.name}
            </h2>
            <div className="text-amber-200/60 mt-1">
              Hôtel de Ville Niv. {village.town_hall_level}
            </div>
          </div>
          <div className="flex gap-2">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 text-center">
              <div className="text-amber-400 text-lg font-bold">{village.town_hall_level}</div>
              <div className="text-amber-500/50 text-xs">HdV</div>
            </div>
          </div>
        </div>

        {/* Resource Bars */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-4">
          {['stone', 'iron', 'gold', 'food', 'wood', 'magic_energy'].map(res => {
            const current = Math.floor(resources[res] || 0);
            const max = Math.floor(resources[`max_${res}`] || 1);
            const noCap = res === 'gold';
            const pct = noCap ? 100 : Math.min(100, (current / max) * 100);
            return (
              <div key={res} className="bg-[#0d0520]/80 rounded-lg p-2 border border-amber-500/20">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-sm">{RESOURCE_ICONS[res]}</span>
                  <span className="text-xs text-amber-300">{RESOURCE_NAMES[res]}</span>
                </div>
                <div className="text-amber-100 text-sm font-bold">{current.toLocaleString()}</div>
                <div className="w-full bg-[#0d0520] rounded-full h-1.5 mt-1">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-amber-500/40 text-xs mt-0.5">{noCap ? '∞' : max.toLocaleString()}</div>
              </div>
            );
          })}
        </div>

        {/* Réserve d'ouvriers partagée */}
        {workers && (
          <div className="mt-4 bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">👷</span>
                <div>
                  <div className="text-amber-300 text-sm font-bold">Réserve d'ouvriers</div>
                  <div className="text-amber-200/60 text-xs">
                    {workers.available} disponible(s) · {workers.used}/{workers.pool} assigné(s) · limite {workers.cap}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-1 min-w-[180px] max-w-sm">
                <div className="flex-1 bg-[#0d0520] rounded-full h-2 border border-amber-500/20">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all"
                    style={{ width: `${Math.min(100, (workers.used / Math.max(1, workers.pool)) * 100)}%` }} />
                </div>
                <button
                  disabled={workers.pool >= workers.cap || (resources.gold || 0) < workers.nextCost}
                  onClick={() => emit('buy_worker', {}, (res: any) => { if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error }); })}
                  className="shrink-0 bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-amber-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap">
                  {workers.pool >= workers.cap
                    ? `Limite atteinte (améliorez l'HdV)`
                    : `+1 ouvrier · 🪙 ${workers.nextCost.toLocaleString()}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Town Hall */}
      {buildings.filter(b => b.type === 'town_hall').map(b => (
        <BuildingCard key={b.id} building={b} emit={emit} workers={workers} />
      ))}

      {/* Bâtiments rangés par type : une ligne par catégorie */}
      {(() => {
        const order: string[] = ['mine', 'lumberjack', 'farm', 'forge', 'library', 'sanctuary'];
        const present = order.filter(t => buildings.some(b => b.type === t));
        // Ajoute les types éventuels non listés (sécurité), hors town_hall/barracks.
        for (const b of buildings) {
          if (b.type !== 'town_hall' && b.type !== 'barracks' && !present.includes(b.type)) present.push(b.type);
        }

        // Production NETTE totale par ressource (prod - conso) avec bonus de niveau.
        const net: Record<string, number> = {};
        for (const b of buildings) {
          if (b.type === 'town_hall' || b.type === 'barracks') continue;
          const info = BUILDING_PROD[b.type] || { prod: {}, cons: {} };
          const mult = 1 + (Math.max(1, b.level) - 1) * 0.25;
          for (const [res, v] of Object.entries(info.prod)) net[res] = (net[res] || 0) + (v as number) * b.workers_assigned * mult * prodBoost;
          for (const [res, v] of Object.entries(info.cons)) net[res] = (net[res] || 0) - (v as number) * b.workers_assigned;
        }
        const netEntries = Object.entries(net).filter(([, v]) => Math.abs(v) > 0.05);

        return (
          <>
            {present.map(type => {
              const group = buildings.filter(b => b.type === type);
              return (
                <div key={type} className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-300/70 text-sm font-bold">
                    <span className="text-lg">{BUILDING_ICONS[type]}</span>
                    <span>{BUILDING_NAMES[type]}</span>
                    <span className="text-amber-500/40 text-xs">×{group.length}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.map(b => (
                      <BuildingCard key={b.id} building={b} emit={emit} workers={workers} />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Résumé de production totale */}
            <div className="bg-[#1a0a2e]/60 border border-green-500/30 rounded-xl p-4">
              <h3 className="text-green-300 font-bold mb-3 flex items-center gap-2">📊 Production totale du village (par seconde)
                {prodBoost > 1 && <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/25 border border-amber-400/50 text-amber-200">🏭 Potion de Prospérité ×{prodBoost} active</span>}
              </h3>
              {netEntries.length === 0 ? (
                <div className="text-green-200/40 text-sm">Aucune production. Assigne des ouvriers à tes bâtiments.</div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  {netEntries.map(([res, v]) => {
                    const pos = v >= 0;
                    return (
                      <div key={res} className={`rounded-lg border p-3 text-center ${pos ? 'border-green-500/30 bg-green-950/20' : 'border-red-500/30 bg-red-950/20'}`}>
                        <div className="text-2xl">{RESOURCE_ICONS[res]}</div>
                        <div className="text-amber-200/60 text-xs mt-0.5">{RESOURCE_NAMES[res]}</div>
                        <div className={`font-bold text-sm mt-1 ${pos ? 'text-green-300' : 'text-red-300'}`}>
                          {pos ? '+' : ''}{v.toFixed(1)}/s
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="text-green-200/30 text-[11px] mt-2">Production nette = production − consommation, bonus de niveau inclus.</div>
            </div>
          </>
        );
      })()}

      {/* Build New */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-4">
        <h3 className="text-amber-400 font-bold mb-3">🏗️ Nouvelle Construction</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          {buildingTypes.map(type => {
            const count = buildings.filter(b => b.type === type).length;
            let canBuild = (tierConfig?.maxBuildings?.[type] || 0) > 0;
            let maxCount = tierConfig?.maxBuildings?.[type] || 0;
            // Forge : 1 à l'HDV 7, 2 à l'HDV 14 (indépendant du palier).
            if (type === 'forge') {
              const thl = village?.town_hall_level || 1;
              maxCount = thl >= 14 ? 2 : thl >= 7 ? 1 : 0;
              canBuild = maxCount > 0;
            }
            const buildCost = getClientBuildingUpgradeCost(type, 0);
            const canAfford = UPGRADE_RESOURCES.every((res) => (resources[res] || 0) >= (buildCost[res] || 0));
            const available = canBuild && count < maxCount;
            return (
              <div key={type} className="relative group">
                <button
                  onClick={() => available && canAfford && emit('build_new', { type }, (res) => {
                    if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
                  })}
                  disabled={!available || !canAfford}
                  className={`w-full p-3 rounded-lg border text-center transition-all ${
                    available && canAfford
                      ? 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/20 cursor-pointer'
                      : available && !canAfford
                      ? 'bg-red-900/10 border-red-500/30 cursor-not-allowed'
                      : 'bg-[#0d0520]/50 border-amber-500/10 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="text-2xl">{BUILDING_ICONS[type]}</div>
                  <div className="text-xs text-amber-300 mt-1">{BUILDING_NAMES[type]}</div>
                  <div className="text-xs text-amber-500/50">{count}/{maxCount}</div>
                </button>

                {/* Tooltip coût de construction */}
                {available && (
                  <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 rounded-xl border border-amber-500/40 bg-[#0d0520]/95 p-3 text-xs shadow-2xl shadow-black/50 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all z-50">
                    <div className="text-amber-300 font-bold mb-2">Ressources nécessaires</div>
                    <div className="space-y-1">
                      {UPGRADE_RESOURCES.filter((res) => buildCost[res] > 0).map((res) => {
                        const owned = Math.floor(resources[res] || 0);
                        const needed = buildCost[res];
                        const enough = owned >= needed;
                        return (
                          <div key={res} className="flex items-center justify-between gap-2">
                            <span className="text-amber-200/80">{RESOURCE_ICONS[res]} {RESOURCE_NAMES[res]}</span>
                            <span className={enough ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                              {owned.toLocaleString()} / {needed.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className={`mt-2 pt-2 border-t border-amber-500/20 font-bold ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                      {canAfford ? 'Tu as assez de ressources' : 'Ressources manquantes'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BUILDING CARD
// ============================================================
function ForgeModal({ emit, forgeLevel, onClose }: { emit: any; forgeLevel: number; onClose: () => void }) {
  const inventory = useGameStore((s: any) => s.inventory) || [];
  const equipment = inventory.filter((it: any) => (it.item_type || '').startsWith('armor_'));
  const [mode, setMode] = useState<'reroll' | 'transfer'>('reroll');
  const [rerollId, setRerollId] = useState<string>('');
  const [sourceId, setSourceId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [stat, setStat] = useState<string>('attack');
  const [busy, setBusy] = useState(false);
  const FORGE_STATS = ['attack', 'defense', 'hp', 'magic', 'speed', 'crit'];
  const quality = 1 + (Math.max(1, Math.min(5, forgeLevel)) - 1) * 0.25;

  const notify = (res: any, okMsg: string) => {
    if (res?.success) useGameStore.getState().addNotification({ type: 'success', message: okMsg });
    else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Échec' });
  };
  const itemById = (id: string) => equipment.find((it: any) => it.id === id);
  const sourceStats = sourceId ? Object.entries(parseItemEffects(itemById(sourceId) || {})).filter(([k, v]) => FORGE_STATS.includes(k) && typeof v === 'number' && v !== 0) : [];

  const OptionLabel = (it: any) => `${it.name}${it.equipped ? ' (équipé)' : ''}${it.locked ? ' 🔒' : ''}`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="max-w-2xl w-full max-h-[85vh] overflow-y-auto bg-gradient-to-br from-[#2a1206] to-[#1a0a2e] border-2 border-orange-400/50 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-orange-300 font-bold text-lg">🔨 Forge — niveau {forgeLevel}/5</h3>
          <button onClick={onClose} className="text-orange-200/60 hover:text-white text-sm font-bold">✕</button>
        </div>
        <p className="text-amber-200/50 text-xs mb-3">Qualité de reroll actuelle : <span className="text-orange-300 font-bold">×{quality.toFixed(2)}</span>. Améliore la forge (très cher, max niv. 5) pour de meilleurs reroll.</p>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('reroll')} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${mode === 'reroll' ? 'bg-orange-500/30 border-orange-400 text-orange-100' : 'bg-black/20 border-amber-500/20 text-amber-200/60'}`}>🎲 Reroll des stats</button>
          <button onClick={() => setMode('transfer')} className={`flex-1 py-2 rounded-lg text-sm font-bold border ${mode === 'transfer' ? 'bg-orange-500/30 border-orange-400 text-orange-100' : 'bg-black/20 border-amber-500/20 text-amber-200/60'}`}>🔀 Transfert d'une stat</button>
        </div>

        {equipment.length === 0 ? (
          <div className="text-amber-500/50 text-center py-6">Aucun équipement dans l'inventaire.</div>
        ) : mode === 'reroll' ? (
          <div className="space-y-3">
            <p className="text-amber-200/60 text-sm">Choisis un équipement : toutes ses statistiques numériques seront retirées au sort (meilleures si la forge est de haut niveau).</p>
            <select value={rerollId} onChange={(e) => setRerollId(e.target.value)} className="w-full bg-[#0d0520] border border-orange-500/30 rounded-lg px-3 py-2 text-amber-100 text-sm">
              <option value="">— Sélectionner un équipement —</option>
              {equipment.map((it: any) => <option key={it.id} value={it.id}>{OptionLabel(it)}</option>)}
            </select>
            {rerollId && <div className="text-xs bg-black/25 rounded-lg p-2 border border-amber-500/10"><ItemStatsDisplay effects={parseItemEffects(itemById(rerollId))} /></div>}
            <button disabled={!rerollId || busy}
              onClick={() => { setBusy(true); emit('forge_reroll', { itemId: rerollId }, (res: any) => { setBusy(false); notify(res, 'Statistiques rerollées !'); }); }}
              className="w-full bg-gradient-to-r from-orange-600 to-red-700 hover:from-orange-500 hover:to-red-600 text-amber-50 py-2.5 rounded-lg font-bold disabled:opacity-40">
              🎲 Reroll
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-amber-200/60 text-sm">Transfère une statistique d'un équipement <span className="text-red-300 font-bold">source</span> (consommé) vers un équipement <span className="text-green-300 font-bold">cible</span>. La valeur écrase celle de la cible.</p>
            <div>
              <label className="text-amber-200/50 text-xs block mb-1">Source (sera détruit, non équipé/verrouillé)</label>
              <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setStat('attack'); }} className="w-full bg-[#0d0520] border border-red-500/30 rounded-lg px-3 py-2 text-amber-100 text-sm">
                <option value="">— Source —</option>
                {equipment.filter((it: any) => !it.equipped && !it.locked).map((it: any) => <option key={it.id} value={it.id}>{OptionLabel(it)}</option>)}
              </select>
            </div>
            {sourceId && (
              <div>
                <label className="text-amber-200/50 text-xs block mb-1">Statistique à transférer</label>
                <select value={stat} onChange={(e) => setStat(e.target.value)} className="w-full bg-[#0d0520] border border-orange-500/30 rounded-lg px-3 py-2 text-amber-100 text-sm">
                  {sourceStats.length === 0 ? <option value="">Aucune stat transférable</option> : sourceStats.map(([k, v]) => <option key={k} value={k}>{STAT_LABELS[k] || k} ({k === 'crit_mult' ? `×${(v as number).toFixed(2)}` : `+${v}`})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-amber-200/50 text-xs block mb-1">Cible (reçoit la stat)</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full bg-[#0d0520] border border-green-500/30 rounded-lg px-3 py-2 text-amber-100 text-sm">
                <option value="">— Cible —</option>
                {equipment.filter((it: any) => it.id !== sourceId).map((it: any) => <option key={it.id} value={it.id}>{OptionLabel(it)}</option>)}
              </select>
            </div>
            <button disabled={!sourceId || !targetId || !stat || sourceStats.length === 0 || busy}
              onClick={() => { setBusy(true); emit('forge_transfer', { sourceId, targetId, stat }, (res: any) => { setBusy(false); notify(res, 'Statistique transférée !'); if (res?.success) { setSourceId(''); setTargetId(''); } }); }}
              className="w-full bg-gradient-to-r from-orange-600 to-red-700 hover:from-orange-500 hover:to-red-600 text-amber-50 py-2.5 rounded-lg font-bold disabled:opacity-40">
              🔀 Transférer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BuildingCard({ building, emit, workers: pool }: { building: any; emit: any; workers: any }) {
  const [workers, setWorkers] = useState(building.workers_assigned);
  const resources = useGameStore((state) => state.resources);
  const isTownHall = building.type === 'town_hall';
  const isLibrary = building.type === 'library';
  const isForge = building.type === 'forge';
  const [forgeOpen, setForgeOpen] = useState(false);
  const FORGE_MAX = 5;
  // Forge : coût d'amélioration spécifique (très cher), miroir du serveur.
  const forgeCost = (lvl: number) => ({
    gold: Math.floor(250000 * Math.pow(3, lvl - 1)),
    iron: Math.floor(40000 * Math.pow(2.4, lvl - 1)),
    stone: Math.floor(40000 * Math.pow(2.4, lvl - 1)),
    wood: Math.floor(40000 * Math.pow(2.4, lvl - 1) * 0.5),
    food: 0,
    magic_energy: Math.floor(40000 * Math.pow(2.4, lvl - 1) * 0.3),
  } as Record<string, number>);
  const upgradeCost = isForge ? forgeCost(building.level) : getClientBuildingUpgradeCost(building.type, building.level);
  const canAffordUpgrade = UPGRADE_RESOURCES.every((res) => (resources?.[res] || 0) >= (upgradeCost[res] || 0));

  // Bâtiments de ressources : niveau max 10. Forge : max 5. Bibliothèque : jamais.
  const isMaxLevel = isLibrary || (isForge && building.level >= FORGE_MAX) || (!isTownHall && !isForge && building.level >= 10);

  // Synchronise le curseur si l'état serveur change (ex. achat d'ouvrier, autre onglet).
  useEffect(() => { setWorkers(building.workers_assigned); }, [building.workers_assigned]);

  // Plafond effectif : limité à la fois par le bâtiment ET la réserve partagée.
  const usedElsewhere = pool ? pool.used - building.workers_assigned : 0;
  const poolRoom = pool ? pool.pool - usedElsewhere : building.max_workers;
  const effectiveMax = Math.max(0, Math.min(building.max_workers, poolRoom));

  const prodInfo = BUILDING_PROD[building.type] || { prod: {}, cons: {} };
  // Rendement par niveau : +25% par niveau (miroir du serveur calculateProduction).
  const levelMult = (lvl: number) => 1 + (Math.max(1, lvl) - 1) * 0.25;
  const curMult = levelMult(building.level);
  const nextMult = levelMult(building.level + 1);
  // Production/conso par seconde à un niveau donné (avec les ouvriers actuels).
  const rate = (perWorker: number, lvl: number) => perWorker * building.workers_assigned * levelMult(lvl);

  return (
    <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-4 hover:border-amber-400/50 transition-all">
      <div className="flex items-center justify-between mb-3">
        {/* Nom + info-bulle au survol */}
        <div className="relative group flex items-center gap-2 cursor-help">
          <span className="text-2xl">{BUILDING_ICONS[building.type]}</span>
          <div>
            <h3 className="text-amber-400 font-bold flex items-center gap-1">
              {BUILDING_NAMES[building.type]}
              <span className="text-amber-500/40 text-xs">ⓘ</span>
            </h3>
            <span className="text-amber-200/50 text-xs">Niveau {building.level}{isForge ? ' / 5' : !isTownHall ? ' / 10' : ''}</span>
          </div>

          <div className="pointer-events-none absolute left-0 top-full mt-2 w-72 rounded-xl border border-amber-500/40 bg-[#0d0520]/95 p-3 text-xs shadow-2xl shadow-black/50 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all z-50">
            <div className="text-amber-300 font-bold mb-1">{BUILDING_ICONS[building.type]} {BUILDING_NAMES[building.type]} · Niv. {building.level}</div>
            <div className="text-amber-200/70 mb-2">{BUILDING_DESC[building.type]}</div>

            {!isTownHall && (
              <div className="space-y-1 border-t border-amber-500/20 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-amber-200/60">👷 Travailleurs</span>
                  <span className="text-amber-300 font-bold">{building.workers_assigned} / {building.max_workers}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-amber-200/60">📈 Bonus de niveau</span>
                  <span className="text-amber-300 font-bold">×{curMult.toFixed(2)}</span>
                </div>
                {Object.entries(prodInfo.prod).filter(([, v]) => (v as number) > 0).map(([res, v]) => (
                  <div key={res} className="flex items-center justify-between">
                    <span className="text-amber-200/60">{RESOURCE_ICONS[res]} {RESOURCE_NAMES[res]} produit</span>
                    <span className="text-green-400 font-bold">+{rate(v as number, building.level).toFixed(1)}/s</span>
                  </div>
                ))}
                {Object.entries(prodInfo.cons).filter(([, v]) => (v as number) > 0).map(([res, v]) => (
                  <div key={res} className="flex items-center justify-between">
                    <span className="text-amber-200/60">{RESOURCE_ICONS[res]} {RESOURCE_NAMES[res]} consommé</span>
                    <span className="text-red-400 font-bold">−{((v as number) * building.workers_assigned).toFixed(1)}/s</span>
                  </div>
                ))}
                {Object.keys(prodInfo.prod).every((k) => !prodInfo.prod[k]) && Object.keys(prodInfo.cons).every((k) => !prodInfo.cons[k]) && (
                  <div className="text-amber-200/40">Aucune production de ressource directe.</div>
                )}
                <div className="text-amber-200/40 text-[11px] pt-1 border-t border-amber-500/10 mt-1">Chaque niveau : +25% de production.</div>
              </div>
            )}
          </div>
        </div>

        <div className="relative group">
          <button
            disabled={isMaxLevel}
            onClick={() => emit('upgrade_building', { buildingId: building.id }, (res: any) => {
              if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
            })}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-lg shadow-amber-900/30 ${
              isMaxLevel
                ? 'bg-[#0d0520] border border-amber-500/20 text-amber-500/40 cursor-not-allowed'
                : canAffordUpgrade
                ? 'bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-100'
                : 'bg-gradient-to-r from-amber-900 to-red-900 hover:from-amber-800 hover:to-red-800 text-amber-100'
            }`}
          >
            {isLibrary ? '🔒 Non améliorable' : isMaxLevel ? '★ Niveau max' : '⬆ Améliorer'}
          </button>

          <div className="pointer-events-none absolute right-0 top-full mt-2 w-64 rounded-xl border border-amber-500/40 bg-[#0d0520]/95 p-3 text-xs shadow-2xl shadow-black/50 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all z-50">
            <div className="text-amber-300 font-bold mb-2">Ressources nécessaires</div>
            <div className="space-y-1">
              {UPGRADE_RESOURCES.filter((res) => upgradeCost[res] > 0).map((res) => {
                const owned = Math.floor(resources?.[res] || 0);
                const needed = upgradeCost[res];
                const enough = owned >= needed;
                return (
                  <div key={res} className="flex items-center justify-between gap-2">
                    <span className="text-amber-200/80">{RESOURCE_ICONS[res]} {RESOURCE_NAMES[res]}</span>
                    <span className={enough ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                      {owned.toLocaleString()} / {needed.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className={`mt-2 pt-2 border-t border-amber-500/20 font-bold ${canAffordUpgrade ? 'text-green-400' : 'text-red-400'}`}>
              {canAffordUpgrade ? 'Tu as assez de ressources' : 'Ressources manquantes'}
            </div>

            {/* Prévisualisation du gain à la prochaine amélioration */}
            {!isTownHall && (
              <div className="mt-2 pt-2 border-t border-amber-500/20">
                {isMaxLevel ? (
                  <div className="text-amber-300 font-bold">★ Niveau maximum (10) atteint</div>
                ) : (
                  <>
                    <div className="text-amber-300 font-bold mb-1">Après amélioration · Niv. {building.level} → {building.level + 1}</div>
                    <div className="text-amber-200/50 mb-1">Bonus production ×{curMult.toFixed(2)} → <span className="text-green-300 font-bold">×{nextMult.toFixed(2)}</span></div>
                    {Object.entries(prodInfo.prod).filter(([, v]) => (v as number) > 0).map(([res, v]) => (
                      <div key={res} className="flex items-center justify-between">
                        <span className="text-amber-200/60">{RESOURCE_ICONS[res]} {RESOURCE_NAMES[res]}</span>
                        <span className="font-bold">
                          <span className="text-amber-200/50">{rate(v as number, building.level).toFixed(1)}</span>
                          <span className="text-green-400"> → {rate(v as number, building.level + 1).toFixed(1)}/s</span>
                        </span>
                      </div>
                    ))}
                    {Object.entries(prodInfo.cons).filter(([, v]) => (v as number) > 0).map(([res, v]) => (
                      <div key={res} className="flex items-center justify-between">
                        <span className="text-amber-200/60">{RESOURCE_ICONS[res]} {RESOURCE_NAMES[res]} (conso)</span>
                        <span className="text-red-300 font-bold">−{((v as number) * building.workers_assigned).toFixed(1)}/s</span>
                      </div>
                    ))}
                    <div className="text-amber-200/40 text-[11px] mt-1">Au niveau {building.level + 1}, +25% de production.{building.workers_assigned === 0 ? ' (assigne des ouvriers pour produire)' : ''}</div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workers (pas pour HDV ni Forge) */}
      {!isTownHall && !isForge && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-amber-300">Travailleurs:</span>
          <input
            type="range"
            min={0}
            max={building.max_workers}
            value={workers}
            onChange={(e) => {
              const v = Math.min(parseInt(e.target.value), effectiveMax);
              setWorkers(v);
            }}
            onMouseUp={() => emit('assign_workers', { buildingId: building.id, workers }, (res: any) => {
              if (!res.success) { useGameStore.getState().addNotification({ type: 'error', message: res.error }); setWorkers(building.workers_assigned); }
            })}
            onTouchEnd={() => emit('assign_workers', { buildingId: building.id, workers }, (res: any) => {
              if (!res.success) { useGameStore.getState().addNotification({ type: 'error', message: res.error }); setWorkers(building.workers_assigned); }
            })}
            className="flex-1 accent-amber-500 h-2"
          />
          <span className="text-amber-400 text-sm font-bold w-8 text-center">{workers}</span>
          <span className="text-amber-500/40 text-xs">/{building.max_workers}</span>
        </div>
      )}

      {/* Production info */}
      <div className="text-xs text-amber-200/40 mt-1">
        {isTownHall
          ? 'Améliorez pour monter de palier et débloquer de nouvelles constructions'
          : isForge
            ? 'Atelier de reroll et de transfert de statistiques — aucun ouvrier requis'
            : pool && effectiveMax < building.max_workers
              ? `${workers} assigné(s) · réserve limitée à ${effectiveMax}`
              : `${workers} travailleur(s) assigné(s)`}
      </div>

      {isForge && (
        <>
          <button onClick={() => setForgeOpen(true)}
            className="mt-2 w-full bg-gradient-to-r from-orange-600 to-red-700 hover:from-orange-500 hover:to-red-600 text-amber-50 px-3 py-2 rounded-lg text-sm font-bold transition-all">
            🔨 Ouvrir la Forge (niv. {building.level})
          </button>
          {forgeOpen && <ForgeModal emit={emit} forgeLevel={building.level} onClose={() => setForgeOpen(false)} />}
        </>
      )}

      {building.type === 'library' && (
        <div className="mt-2 text-[11px] bg-[#0d0520]/60 rounded-lg p-2 border border-blue-500/20">
          {building.workers_assigned > 0
            ? <span className="text-blue-300">📚 Entraîne le héros : +{(building.workers_assigned * 0.5).toFixed(1)} XP / 5 min ({building.workers_assigned} ouvrier·s)</span>
            : <span className="text-amber-500/50">📚 Assigne des ouvriers pour entraîner le héros (+0,5 XP/ouvrier toutes les 5 min).</span>}
        </div>
      )}
    </div>
  );
}

// Compte à rebours de fabrication d'équipement de la forge.
function ForgeProgress({ workers, startedAt, level }: { workers: number; startedAt: number; level: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!workers || workers <= 0) {
    return <div className="mt-2 text-[11px] text-amber-500/50 bg-[#0d0520]/60 rounded-lg p-2 border border-amber-500/10">🔥 Assigne des ouvriers pour forger des équipements (plus d'ouvriers = plus rapide).</div>;
  }
  const base = 1800;
  const craftSecs = Math.max(120, Math.floor(base / workers));
  const now = Date.now() / 1000;
  const start = startedAt && startedAt > 0 ? startedAt : now;
  const elapsed = Math.max(0, now - start);
  const remaining = Math.max(0, craftSecs - (elapsed % craftSecs));
  const pct = Math.min(100, ((craftSecs - remaining) / craftSecs) * 100);
  const mm = Math.floor(remaining / 60);
  const ss = Math.floor(remaining % 60);

  return (
    <div className="mt-2 bg-[#0d0520]/70 rounded-lg p-2 border border-orange-500/20">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-orange-300 font-bold">🔥 Forge en cours</span>
        <span className="text-amber-200/70">{mm}:{ss.toString().padStart(2, '0')} restant</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/50 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-orange-600 to-amber-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-amber-200/40 mt-1">Produit un équipement basique toutes les {Math.floor(craftSecs / 60)} min {craftSecs % 60 ? `${craftSecs % 60}s` : ''} · forge niv. {level}</div>
    </div>
  );
}

// ============================================================
// TROOPS TAB
// ============================================================
function TroopsTab({ emit }: { emit: any }) {
  const { troops, tierConfig, resources } = useGameStore();

  const availableTroops = ['soldier', 'archer', 'knight', 'mage_guard', 'golem', 'dragon_rider', 'shadow_assassin', 'holy_paladin']
    .filter(t => (tierConfig?.unlockTroops || ['soldier']).includes(t));

  const ownedCount: Record<string, number> = {};
  troops.forEach(t => { ownedCount[t.type] = (ownedCount[t.type] || 0) + t.count; });
  const totalArmy = troops.reduce((n: number, t: any) => n + t.count, 0);

  return (
    <div className="space-y-6">
      {/* CASERNE — choix précis de la troupe à produire */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 className="text-2xl font-bold text-amber-400" style={{ fontFamily: 'serif' }}>🏰 Caserne</h2>
          <div className="text-amber-200/50 text-sm">Armée totale : <span className="text-amber-300 font-bold">{totalArmy}</span> unité(s)</div>
        </div>
        <p className="text-amber-200/40 text-sm mb-4">Choisis exactement quelle unité produire. Chaque troupe a un rôle et un atout uniques. Les unités verrouillées 🔒 se débloquent en améliorant ton Hôtel de Ville.</p>
        <TroopRecruiter emit={emit} availableTroops={availableTroops} ownedCount={ownedCount} resources={resources} />
      </div>

      {/* ARMÉE — unités possédées + amélioration */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-4" style={{ fontFamily: 'serif' }}>⚔️ Armée du Village</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {troops.map(t => {
            const d = TROOP_DATA[t.type];
            const role = d ? ROLE_INFO[d.role] : null;
            const lvl = t.level || 1;
            const stats = d ? troopStatsAtLevel(d, lvl) : null;
            const maxed = lvl >= TROOP_MAX_LEVEL;
            const upCost = d && !maxed ? computeTroopUpgradeCost(d, lvl) : {};
            const canUp = !maxed && resources && Object.entries(upCost).every(([r, v]) => (resources[r] ?? 0) >= (v as number));
            return (
              <div key={t.id} className="relative bg-[#0d0520]/80 border border-amber-500/20 rounded-lg p-3 overflow-hidden">
                {d && <div className={`absolute inset-0 bg-gradient-to-br ${d.accent} opacity-15`} />}
                <div className="relative flex items-center gap-3">
                  <div className="flex items-center justify-center h-16 w-16 shrink-0">
                    {d ? <SpriteAnimation sprite={d.sprite} height={62} mode="idle" />
                       : <span className="text-3xl">{TROOP_ICONS[t.type] || '🗡️'}</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="text-amber-300 font-bold text-sm truncate">{TROOP_NAMES[t.type] || t.type}</div>
                    {role && <div className="text-amber-200/60 text-[11px]">{role.icon} {role.name}</div>}
                    <div className="text-amber-100 text-lg font-bold leading-tight">{t.count} <span className="text-amber-500/40 text-xs font-normal">· Niv. {lvl}</span></div>
                  </div>
                </div>

                {stats && (
                  <div className="relative grid grid-cols-3 gap-1 mt-2 text-[11px] text-center">
                    <div className="bg-black/30 rounded py-0.5"><span className="text-red-300">⚔ {stats.attack}</span></div>
                    <div className="bg-black/30 rounded py-0.5"><span className="text-blue-300">🛡 {stats.defense}</span></div>
                    <div className="bg-black/30 rounded py-0.5"><span className="text-green-300">❤ {stats.hp}</span></div>
                  </div>
                )}
                {role && <div className="relative text-amber-200/45 text-[10px] mt-1 leading-snug">{d?.roleBonus}</div>}

                {!maxed && (
                  <div className="relative mt-2 pt-2 border-t border-amber-500/15">
                    <div className="text-amber-200/50 text-[10px] mb-1">Coût amélioration → Niv. {lvl + 1}</div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                      {Object.entries(upCost).filter(([, v]) => (v as number) > 0).map(([res, v]) => {
                        const have = resources?.[res] ?? 0;
                        const enough = have >= (v as number);
                        return (
                          <span key={res} className={enough ? 'text-amber-100/80' : 'text-red-400'}>
                            {RESOURCE_ICONS[res]} {(v as number).toLocaleString()}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!canUp}
                  onClick={() => emit('upgrade_troop', { type: t.type }, (res: any) => { if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Amélioration impossible' }); })}
                  className={`relative mt-2 w-full py-1.5 rounded-lg text-xs font-bold transition-all ${
                    maxed
                      ? 'bg-amber-500/10 text-amber-400/50 cursor-default'
                      : canUp
                        ? 'bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-100'
                        : 'bg-[#0d0520] border border-amber-500/10 text-amber-500/30 cursor-not-allowed'
                  }`}>
                  {maxed
                    ? '★ Niveau max'
                    : canUp
                      ? `⬆ Améliorer (Niv. ${lvl + 1})`
                      : `Ressources manquantes`}
                </button>
              </div>
            );
          })}
          {troops.length === 0 && (
            <div className="col-span-full text-center text-amber-500/50 py-8">Aucune troupe. Produis ta première unité dans la caserne ci-dessus.</div>
          )}
        </div>
      </div>
    </div>
  );
}


const STAT_LABELS: Record<string, string> = {
  attack: 'Attaque', defense: 'Défense', hp: 'PV', magic: 'Magie', speed: 'Vitesse', crit: 'Critique', crit_mult: 'Mult. critique'
};

const SLOT_LABELS: Record<string, string> = {
  armor_helmet: 'Casque', armor_shoulders: 'Épaulières', armor_gloves: 'Gants', armor_chest: 'Plastron',
  armor_boots: 'Bottes', armor_shield: 'Bouclier', armor_bracers: 'Brassards', armor_relic: 'Relique', armor: 'Armure'
};

function parseItemEffects(item: any) {
  try { return JSON.parse(item.effects || '{}'); } catch { return {}; }
}

// Nom lisible d'un set (__set = 'set_<rareté>').
const SET_LABELS: Record<string, string> = {
  set_common: 'Set Commun', set_rare: 'Set Rare', set_epic: 'Set Épique',
  set_legendary: 'Set Légendaire', set_mythic: 'Set Mythique', set_supreme: 'Set Suprême', set_god: 'Set GOD',
};
function setLabel(setId?: string) { return setId ? (SET_LABELS[setId] || 'Set') : null; }

function formatItemStats(effects: any) {
  return Object.entries(effects || {})
    .filter(([k, v]) => !k.startsWith('__') && typeof v === 'number' && (v as number) !== 0)
    .map(([k, v]) => k === 'crit_mult' ? `💥 ${STAT_LABELS[k] || k} ×${(v as number).toFixed(2)}` : `+${v} ${STAT_LABELS[k] || k}`)
    .join(' • ');
}

// Affiche les stats de base d'un item PUIS les atouts ajoutés par le craft
// (enchantements) dans une couleur distincte (violet) pour bien les repérer.
function ItemStatsDisplay({ effects, className = '' }: { effects: any; className?: string }) {
  const base = formatItemStats(effects);
  let enchants: Record<string, number> = {};
  try { enchants = (effects && effects.__enchants) || {}; } catch { enchants = {}; }
  const enchantEntries = Object.entries(enchants).filter(([, n]) => (n as number) > 0);
  return (
    <span className={className}>
      {base && <span className="text-amber-200/70">{base}</span>}
      {enchantEntries.length > 0 && (
        <span className="text-fuchsia-400 font-semibold">
          {base ? ' • ' : ''}
          {enchantEntries.map(([s, n]) => `✦ ${ENCHANT_STAT_LABELS[s] || s} +${enchantTotal(s, n as number)}`).join(' • ')}
        </span>
      )}
    </span>
  );
}

// Objet de boss = trophée non équipable (inventaire séparé "Butin").
// Reconnu par son icône (boss_item_ ou campaign_items), le type 'item', ou le flag __noStats.
function isBossItem(item: any): boolean {
  const eff = parseItemEffects(item);
  const icon = eff.__icon || item.icon || '';
  if (item.item_type === 'item') return true;
  if (eff.__noStats) return true;
  return typeof icon === 'string' && (icon.includes('boss_item_') || icon.includes('campaign_items'));
}

// ============================================================
// HERO TAB
// ============================================================
// Effet chiffré d'une compétence à un niveau donné, selon le héros courant.
// lv = 0 → non apprise. Renvoie une chaîne lisible ("142 dégâts", "+25% attaque"...).
function skillEffectValue(skillId: string, lv: number, hero: any): { value: number; text: string } | null {
  const spec = SKILL_BY_ID[skillId];
  if (!spec || lv <= 0) return null;
  const h = { attack: hero.attack, defense: hero.defense, hp: hero.hp, magic: hero.magic, level: hero.level };
  const v = spec.value(lv, h as any);
  let text = String(v);
  switch (spec.kind) {
    case 'attack': text = `${v} dégâts`; break;
    case 'magic': text = `${v} dégâts magiques`; break;
    case 'stun': { const ch = Math.min(70, 38 + lv * 2); text = `${v} dégâts + ${ch}% d'étourdir`; break; }
    case 'heal': text = `+${v} PV soignés`; break;
    case 'buff': text = `+${Math.round(v * 100)}% attaque troupes`; break;
    case 'defense': text = `-${Math.round(v * 100)}% dégâts subis`; break;
  }
  return { value: v, text };
}

// Barre des chances d'obtention de chaque rareté lors des combats.
// Miroir des taux du serveur (generateArmorDrop) : Suprême 0,1%, Mythique 1%,
// reste réparti rare/épique/légendaire. GOD = créée au craft (pas un drop).
function RarityOddsBar() {
  const ROWS = [
    { key: 'common',    label: 'Commun',     pct: 0,    color: '#9ca3af' },
    { key: 'rare',      label: 'Rare',       pct: 56.4, color: '#60a5fa' },
    { key: 'epic',      label: 'Épique',     pct: 33.6, color: '#c084fc' },
    { key: 'legendary', label: 'Légendaire', pct: 8.9,  color: '#fbbf24' },
    { key: 'mythic',    label: 'Mythique',   pct: 1,    color: '#fb923c' },
    { key: 'supreme',   label: 'Suprême',    pct: 0.1,  color: '#ef4444' },
  ].filter(r => r.pct > 0);
  return (
    <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-amber-400 font-bold text-sm">🎲 Chances d'obtention par rareté (en combat)</h3>
        <span className="text-amber-200/40 text-[11px]">GOD : uniquement au craft</span>
      </div>
      <div className="flex h-5 w-full overflow-hidden rounded-full border border-amber-500/20">
        {ROWS.map(r => (
          <div key={r.key} title={`${r.label} : ${r.pct}%`}
            style={{ width: `${r.pct}%`, backgroundColor: r.color, minWidth: r.pct < 1 ? '4px' : undefined }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {ROWS.map(r => (
          <div key={r.key} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: r.color }} />
            <span className="text-amber-100/70">{r.label}</span>
            <span className="text-amber-200/40">{r.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Invitation de groupe (coop) : expire automatiquement après 30s.
function PartyInviteModal({ invite, emit, onClose }: { invite: any; emit: any; onClose: () => void }) {
  const [left, setLeft] = useState(30);
  useEffect(() => {
    const started = invite.received || Date.now();
    const tick = () => {
      const remaining = Math.max(0, 30 - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining <= 0) onClose();
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [invite, onClose]);

  const respond = (accept: boolean) => {
    emit('party_invite_respond', { roomId: invite.roomId, accept }, (res: any) => {
      if (accept && res?.success) {
        useGameStore.getState().setPartyRoom({ roomId: res.roomId, mode: res.mode, target: res.target, multiplier: res.multiplier });
        useGameStore.getState().setCurrentTab(res.mode === 'tower' ? 'tower' : 'boss');
      } else if (accept && !res?.success) {
        useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Impossible de rejoindre' });
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
      <div className="max-w-sm w-full bg-gradient-to-br from-[#152a35] to-[#0a1a2e] border-2 border-cyan-400 rounded-2xl shadow-2xl px-6 py-6 text-center">
        <div className="text-3xl mb-2">👥</div>
        <div className="text-cyan-300 font-extrabold text-lg mb-1">Invitation de groupe</div>
        <div className="text-cyan-100/80 text-sm mb-1">
          <span className="font-bold text-cyan-200">{invite.host}</span> t'invite à rejoindre son groupe ({invite.mode === 'tower' ? '🗼 Tour' : '⚔️ Boss'}).
        </div>
        <div className="text-cyan-200/50 text-xs mb-4">Expire dans <span className="font-bold text-cyan-200">{left}s</span></div>
        <div className="flex gap-2">
          <button onClick={() => respond(true)}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-cyan-600 to-cyan-800 hover:from-cyan-500 hover:to-cyan-700 text-white">
            Accepter
          </button>
          <button onClick={() => respond(false)}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-black/30 border border-cyan-500/30 text-cyan-200/70 hover:text-cyan-100">
            Refuser
          </button>
        </div>
      </div>
    </div>
  );
}

// Carte d'un équipement (réutilisée pour « Équipés » et « Tous »).
function EquipmentCard({ item, emit, selectMode, selected, toggleSelect }: { item: any; emit: any; selectMode: boolean; selected: boolean; toggleSelect: (id: string) => void }) {
  const effects = parseItemEffects(item);
  const icon = effects.__icon;
  const bonus = effects.__bonus;
  const source = effects.__source || item.source;
  const locked = !!item.locked;
  // En mode sélection, un équipement verrouillé ne peut pas être coché.
  const selectable = selectMode && !locked;
  return (
    <div
      onClick={selectable ? () => toggleSelect(item.id) : undefined}
      className={`relative bg-[#0d0520]/80 rounded-lg p-3 border transition-all ${selectable ? 'cursor-pointer' : (selectMode && locked ? 'cursor-not-allowed opacity-60' : '')} ${selected ? 'border-red-400 ring-2 ring-red-400/40' : (locked ? 'border-amber-400/60' : (RARITY_BG[item.rarity] || 'border-gray-600'))}`}>
      {/* Bouton cadenas (ouvert/fermé) — bloque la suppression quand fermé. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          emit('hero_toggle_lock', { itemId: item.id }, (res: any) => {
            if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
          });
        }}
        title={locked ? 'Verrouillé — clique pour déverrouiller' : 'Déverrouillé — clique pour verrouiller (protège de la suppression)'}
        className={`absolute bottom-1.5 right-1.5 z-10 h-7 w-7 rounded-md border flex items-center justify-center transition-all ${locked ? 'bg-amber-500/25 border-amber-400/60 hover:bg-amber-500/35' : 'bg-black/30 border-amber-500/20 hover:bg-black/50'}`}>
        <img src={locked ? '/ui/lock_closed.svg' : '/ui/lock_open.svg'} alt={locked ? 'verrouillé' : 'déverrouillé'} className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        {selectMode && (
          <div className={`mt-1 h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${locked ? 'border-amber-500/20 bg-black/30' : selected ? 'bg-red-500 border-red-400 text-white' : 'border-amber-500/40'}`}>
            {locked ? '🔒' : selected ? '✓' : ''}
          </div>
        )}
        <div className="relative h-14 w-14 shrink-0 rounded-lg border border-amber-500/20 bg-black/25 flex items-center justify-center overflow-hidden">
          {icon ? <img src={icon} alt="" className="h-full w-full object-contain" /> : <span className="text-2xl">🛡️</span>}
          {item.equipped && (
            <span title="Équipé" className="absolute -top-1 -right-1 bg-green-600 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center border border-green-300/60 shadow">✓</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className={`font-bold text-sm ${RARITY_COLORS[item.rarity]}`}>{item.name}</span>
            {selectMode ? null : item.equipped ? (
              <button
                onClick={() => emit('hero_unequip', { itemId: item.id }, (res: any) => {
                  if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
                })}
                className="text-amber-300/70 text-xs bg-black/30 border border-amber-500/20 px-2 py-0.5 rounded hover:bg-amber-500/15 transition-all whitespace-nowrap"
              >
                Déséquiper
              </button>
            ) : (
              <button
                onClick={() => emit('hero_equip', { itemId: item.id }, (res: any) => {
                  if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
                })}
                className="text-amber-400 text-xs bg-amber-500/20 px-2 py-0.5 rounded hover:bg-amber-500/30 transition-all whitespace-nowrap"
              >
                Équiper
              </button>
            )}
          </div>
          <div className="text-amber-200/40 text-xs mt-1">
            {item.rarity === 'rare' ? '⭐ Rare' : item.rarity === 'epic' ? '💎 Épique' : item.rarity === 'legendary' ? '🌟 Légendaire' : item.rarity === 'mythic' ? '🟠 Mythique' : item.rarity === 'supreme' ? '🔴 Suprême' : item.rarity === 'god' ? '⚡ GOD' : 'Commun'}
            {' | '}{SLOT_LABELS[item.item_type] || item.item_type}
          </div>
          <div className="text-amber-200/35 text-xs mt-1">Source : {source}</div>
          {effects.__set && (
            <div className="text-cyan-300/70 text-xs mt-1 font-bold">🧩 {setLabel(effects.__set)} <span className="text-cyan-200/40 font-normal">— 3 pièces équipées : +5% critique</span></div>
          )}
          <div className="text-amber-200/70 text-xs mt-1 font-medium">
            <ItemStatsDisplay effects={effects} />
          </div>
          {bonus && <div className="text-purple-200/50 text-xs mt-1">Bonus appliqué : {bonus}</div>}
        </div>
      </div>
    </div>
  );
}

function HeroTab({ emit }: { emit: any }) {
  const { hero, inventory } = useGameStore();
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  // Sépare les objets de boss (non équipables) des équipements.
  const bossLoot = inventory.filter((it: any) => isBossItem(it));
  const equipment = inventory.filter((it: any) => !isBossItem(it));

  // Sécurité : si un objet de boss est équipé (bug), on le déséquipe automatiquement.
  useEffect(() => {
    bossLoot.forEach((it: any) => {
      if (it.equipped) {
        emit('hero_unequip', { itemId: it.id }, () => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory]);

  // Tri + sélection multiple des équipements.
  const [sortBy, setSortBy] = useState<'type' | 'rarity'>('type');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const RARITY_ORDER: Record<string, number> = { god: -2, supreme: -1, mythic: 0, legendary: 1, epic: 2, rare: 3, common: 4 };
  const sortedEquipment = [...equipment].sort((a: any, b: any) => {
    if (sortBy === 'rarity') {
      const r = (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9);
      if (r !== 0) return r;
      return String(a.item_type).localeCompare(String(b.item_type));
    }
    const t = String(a.item_type).localeCompare(String(b.item_type));
    if (t !== 0) return t;
    return (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => { setSelectedIds(new Set()); setSelectMode(false); };
  const [confirmEquippedDiscard, setConfirmEquippedDiscard] = useState<string[] | null>(null);
  const doDiscard = (ids: string[]) => {
    if (ids.length === 0) return;
    emit('hero_discard', { itemIds: ids }, (res: any) => {
      if (res?.success) {
        const blocked = res.blocked || 0;
        useGameStore.getState().addNotification({
          type: 'success',
          message: `${res.removed ?? ids.length} équipement(s) abandonné(s).${blocked ? ` ${blocked} verrouillé(s) ignoré(s).` : ''}`,
        });
        clearSelection();
      } else {
        useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Abandon impossible' });
      }
    });
  };
  const discardSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Confirmation spécifique si l'un des équipements sélectionnés est équipé.
    const hasEquipped = sortedEquipment.some((it: any) => selectedIds.has(it.id) && it.equipped);
    if (hasEquipped) { setConfirmEquippedDiscard(ids); return; }
    doDiscard(ids);
  };

  const SKILLS = [
    { id: 'power_strike', name: 'Frappe puissante', icon: '💥', desc: 'Inflige des dégâts physiques basés sur l\'Attaque du héros. Recharge : 1 tour.', maxLevel: 40 },
    { id: 'arcane_blast', name: 'Déflagration arcanique', icon: '🔮', desc: 'Inflige des dégâts magiques basés sur la Magie du héros. Recharge : 2 tours.', maxLevel: 40 },
    { id: 'heal_light', name: 'Lumière guérisseuse', icon: '💚', desc: 'Soigne les PV de l\'armée, montant basé sur la Magie. Recharge : 2 tours.', maxLevel: 40 },
    { id: 'war_cry', name: 'Cri de guerre', icon: '📯', desc: 'Augmente l\'attaque des troupes pendant 3 tours. Recharge : 3 tours.', maxLevel: 40 },
    { id: 'iron_wall', name: 'Mur de fer', icon: '🛡️', desc: 'Réduit les dégâts subis pendant 2 tours. Recharge : 3 tours.', maxLevel: 40 },
    { id: 'shield_bash', name: 'Coup de bouclier', icon: '🔨', desc: 'Dégâts physiques + chance d\'étourdir l\'ennemi 1 tour (40% au niv.1 puis +2%/niv jusqu\'à 70%). Recharge : 3 tours.', maxLevel: 20 },
    { id: 'berserker', name: 'Berserker', icon: '💢', desc: 'Énorme frappe physique, renforcée quand les PV sont bas. Recharge : 3 tours.', maxLevel: 20 },
  ];

  if (!hero) return <LoadingSpinner />;

  const skills = JSON.parse(hero.skills || '{}');
  const xpNeeded = Math.floor(100 * Math.pow(1.5, hero.level - 1));
  const xpPct = Math.min(100, (hero.xp / xpNeeded) * 100);

  return (
    <div className="space-y-6">
      {/* Hero Info */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-start gap-6 flex-wrap">
          <div className="text-center">
            <div className="w-24 h-24 bg-gradient-to-br from-amber-500/20 to-purple-500/20 rounded-full flex items-center justify-center text-5xl border-2 border-amber-400/50 mx-auto">
              🦸
            </div>
            <div className="text-amber-400 font-bold mt-2">{hero.name}</div>
            <div className="text-amber-200/50 text-sm">Niveau {hero.level}</div>
          </div>

          <div className="flex-1 min-w-[200px]">
            {/* XP Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-amber-300 mb-1">
                <span>XP: {Math.floor(hero.xp)} / {xpNeeded}</span>
                <span>Points: {hero.skill_points}</span>
              </div>
              <div className="w-full bg-[#0d0520] rounded-full h-3">
                <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all" style={{ width: `${xpPct}%` }} />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Attaque', value: Math.floor(hero.attack), icon: '⚔️', color: 'text-red-400' },
                { label: 'Défense', value: Math.floor(hero.defense), icon: '🛡️', color: 'text-blue-400' },
                { label: 'PV', value: Math.floor(hero.hp), icon: '❤️', color: 'text-green-400' },
                { label: 'Magie', value: Math.floor(hero.magic), icon: '✨', color: 'text-purple-400' },
              ].map(stat => (
                <div key={stat.label} className="bg-[#0d0520]/80 rounded-lg p-2 border border-amber-500/20 flex items-center gap-2">
                  <span>{stat.icon}</span>
                  <div>
                    <div className="text-amber-200/50 text-xs">{stat.label}</div>
                    <div className={`font-bold ${stat.color}`}>{stat.value}</div>
                  </div>
                </div>
              ))}
              {/* Critique : chance + multiplicateur de dégâts */}
              <div className="col-span-2 bg-[#0d0520]/80 rounded-lg p-2 border border-orange-500/30 flex items-center gap-2">
                <span>💥</span>
                <div className="flex-1">
                  <div className="text-amber-200/50 text-xs">Critique</div>
                  <div className="font-bold text-orange-400 text-sm">
                    {Math.round((hero.crit_chance ?? 0.05) * 100)}% de chance · ×{(hero.crit_mult ?? 1.1).toFixed(2)} dégâts
                  </div>
                  {(hero.crit_set_bonus ?? 0) > 0 && (
                    <div className="text-cyan-300/70 text-[10px]">🧩 Inclut +{Math.round((hero.crit_set_bonus) * 100)}% de bonus de set actif.</div>
                  )}
                  <div className="text-amber-200/35 text-[10px]">
                    Chance améliorable dans Compétences (max {Math.round((hero.crit_max_chance ?? 0.35) * 100)}%). Multiplicateur via équipements (max ×{(hero.crit_max_mult ?? 2.5).toFixed(1)}).
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Skills */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-400 font-bold mb-3">🌟 Compétences</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {(() => {
            const critLv = hero.crit_level ?? 0;
            const critMaxLv = hero.crit_max_level ?? 35;
            const curChance = hero.crit_chance ?? 0.05;
            const maxChance = hero.crit_max_chance ?? 0.35;
            // Chance prévue au niveau suivant (même formule que le serveur).
            const baseC = 0.05, maxC = maxChance;
            const nextChance = critLv < critMaxLv ? baseC + (maxC - baseC) * ((critLv + 1) / critMaxLv) : curChance;
            return (
              <div className="bg-[#0d0520]/80 rounded-lg p-3 border border-orange-500/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-lg">💥</span>
                  <span className="text-orange-400 text-sm font-bold">{critLv}/{critMaxLv}</span>
                </div>
                <div className="text-orange-300 text-xs font-bold">Critique <span className="text-orange-200/40 font-normal">(passif)</span></div>
                <div className="text-amber-200/40 text-xs">Chance qu'une attaque du héros soit critique. Passif non utilisable : il s'applique automatiquement à chaque attaque.</div>
                <div className="mt-2 rounded bg-black/30 border border-orange-500/10 px-2 py-1 text-[11px]">
                  <div className="text-amber-200/70">Chance actuelle : <span className="text-orange-200 font-bold">{Math.round(curChance * 100)}%</span></div>
                  <div className="text-amber-200/70">Multiplicateur : <span className="text-orange-200 font-bold">×{(hero.crit_mult ?? 1.1).toFixed(2)}</span> <span className="text-amber-200/35">(via équipements)</span></div>
                  {critLv < critMaxLv ? (
                    <div className="text-green-300/80">Niv. {critLv + 1} : <span className="font-bold">{Math.round(nextChance * 100)}%</span> <span className="text-green-400/70">(+{Math.round((nextChance - curChance) * 100)}%)</span></div>
                  ) : (
                    <div className="text-orange-400/60">★ Chance au maximum</div>
                  )}
                </div>
                {critLv < critMaxLv && hero.skill_points > 0 && (
                  <button
                    onClick={() => emit('hero_upgrade_crit', {}, (res: any) => {
                      if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
                    })}
                    className="mt-2 w-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 text-xs py-1 rounded transition-all"
                  >
                    +1 chance (1 pt)
                  </button>
                )}
              </div>
            );
          })()}
          {SKILLS.map(skill => {
            const level = skills[skill.id] || 0;
            const cur = skillEffectValue(skill.id, level, hero);
            const next = level < skill.maxLevel ? skillEffectValue(skill.id, level + 1, hero) : null;
            return (
              <div key={skill.id} className="bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-lg">{skill.icon}</span>
                  <span className="text-amber-400 text-sm font-bold">{level}/{skill.maxLevel}</span>
                </div>
                <div className="text-amber-300 text-xs font-bold">{skill.name}</div>
                <div className="text-amber-200/40 text-xs">{skill.desc}</div>

                {/* Suivi chiffré */}
                <div className="mt-2 rounded bg-black/30 border border-amber-500/10 px-2 py-1 text-[11px]">
                  {level === 0 ? (
                    <div className="text-amber-200/50">
                      Non apprise · au niv. 1 : <span className="text-amber-200 font-bold">{next?.text}</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-amber-200/70">Effet actuel : <span className="text-amber-100 font-bold">{cur?.text}</span></div>
                      {next ? (
                        <div className="text-green-300/80">Niv. {level + 1} : <span className="font-bold">{next.text}</span>
                          {cur && next.value !== cur.value && (
                            <span className="text-green-400/70"> ({next.value > cur.value ? '+' : ''}{next.value - cur.value})</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-amber-400/60">★ Niveau max</div>
                      )}
                    </>
                  )}
                </div>

                {level < skill.maxLevel && hero.skill_points > 0 && (
                  <button
                    onClick={() => emit('hero_upgrade_skill', { skillId: skill.id }, (res: any) => {
                      if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
                    })}
                    className="mt-2 w-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs py-1 rounded transition-all"
                  >
                    +1 (1 pt)
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Barre des chances d'obtention par rareté en combat */}
      <RarityOddsBar />

      {/* Équipements ÉQUIPÉS — carré séparé au-dessus */}
      {(() => {
        const equipped = sortedEquipment.filter((it: any) => it.equipped);
        return (
          <div className="bg-[#1a0a2e]/60 border border-green-500/30 rounded-xl p-6">
            <h3 className="text-green-300 font-bold mb-3">✓ Équipements équipés <span className="text-green-200/40 text-xs">({equipped.length})</span></h3>
            {equipped.length === 0 ? (
              <div className="text-green-300/40 text-center py-4">Aucun équipement équipé. Équipe une pièce depuis le carré ci-dessous.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {equipped.map((item: any) => (
                  <EquipmentCard key={item.id} item={item} emit={emit} selectMode={false} selected={false} toggleSelect={toggleSelect} />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Inventory — TOUS les équipements */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-amber-400 font-bold">🎒 Tous les équipements</h3>
          {equipment.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-amber-200/40 text-xs">Trier :</span>
              <button onClick={() => setSortBy('type')}
                className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${sortBy === 'type' ? 'bg-amber-500/30 text-amber-200' : 'bg-black/20 text-amber-200/50 hover:text-amber-200'}`}>
                Type
              </button>
              <button onClick={() => setSortBy('rarity')}
                className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${sortBy === 'rarity' ? 'bg-amber-500/30 text-amber-200' : 'bg-black/20 text-amber-200/50 hover:text-amber-200'}`}>
                Rareté
              </button>
              <span className="w-px h-4 bg-amber-500/20" />
              {selectMode ? (
                <>
                  <span className="text-amber-200/50 text-xs">{selectedIds.size} sélectionné(s)</span>
                  {(() => {
                    const selectable = sortedEquipment.filter((it: any) => !it.equipped && !it.locked);
                    const allSelected = selectable.length > 0 && selectable.every((it: any) => selectedIds.has(it.id));
                    return (
                      <button onClick={() => {
                        if (allSelected) setSelectedIds(new Set());
                        else setSelectedIds(new Set(selectable.map((it: any) => it.id)));
                      }}
                        className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-all">
                        {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                    );
                  })()}
                  <button onClick={discardSelected} disabled={selectedIds.size === 0}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${selectedIds.size === 0 ? 'bg-black/20 text-red-400/30 cursor-not-allowed' : 'bg-red-500/25 text-red-300 hover:bg-red-500/40'}`}>
                    🗑 Abandonner
                  </button>
                  <button onClick={clearSelection}
                    className="px-2 py-0.5 rounded text-xs font-bold bg-black/20 text-amber-200/50 hover:text-amber-200 transition-all">
                    Annuler
                  </button>
                  {/* Sélection rapide par rareté : ajoute tous les équipements
                      sélectionnables (non équipés, non verrouillés) d'une rareté. */}
                  {(() => {
                    const selectable = sortedEquipment.filter((it: any) => !it.equipped && !it.locked);
                    const RARITY_PICK = [
                      { id: 'common', label: 'Commun' },
                      { id: 'rare', label: 'Rare' },
                      { id: 'epic', label: 'Épique' },
                      { id: 'legendary', label: 'Légendaire' },
                      { id: 'mythic', label: 'Mythique' },
                      { id: 'supreme', label: 'Suprême' },
                      { id: 'god', label: 'GOD' },
                    ];
                    const counts: Record<string, number> = {};
                    for (const it of selectable) counts[it.rarity] = (counts[it.rarity] || 0) + 1;
                    const available = RARITY_PICK.filter(r => (counts[r.id] || 0) > 0);
                    if (available.length === 0) return null;
                    return (
                      <div className="basis-full flex items-center gap-1.5 flex-wrap mt-1">
                        <span className="text-amber-200/40 text-xs">Par rareté :</span>
                        {available.map(r => {
                          const ofRarity = selectable.filter((it: any) => it.rarity === r.id);
                          const allOfRarity = ofRarity.every((it: any) => selectedIds.has(it.id));
                          return (
                            <button key={r.id}
                              onClick={() => setSelectedIds(prev => {
                                const next = new Set(prev);
                                // Toggle : si toute la rareté est déjà cochée, on la décoche, sinon on la coche.
                                if (allOfRarity) ofRarity.forEach((it: any) => next.delete(it.id));
                                else ofRarity.forEach((it: any) => next.add(it.id));
                                return next;
                              })}
                              className={`px-2 py-0.5 rounded text-xs font-bold transition-all border ${allOfRarity ? 'bg-red-500/25 border-red-400/50 text-red-200' : `bg-black/20 border-amber-500/20 ${RARITY_COLORS[r.id] || 'text-amber-200/60'} hover:bg-amber-500/15`}`}>
                              {r.label} ({counts[r.id]})
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <button onClick={() => setSelectMode(true)}
                  className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-all">
                  Sélectionner
                </button>
              )}
            </div>
          )}
        </div>
        {equipment.length === 0 ? (
          <div className="text-amber-500/50 text-center py-4">Aucun équipement. Combattez pour obtenir des équipements !</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sortedEquipment.map((item: any) => (
              <EquipmentCard key={item.id} item={item} emit={emit} selectMode={selectMode} selected={selectedIds.has(item.id)} toggleSelect={toggleSelect} />
            ))}
          </div>
        )}
      </div>

      {/* Confirmation : abandon d'un équipement ÉQUIPÉ */}
      {confirmEquippedDiscard && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4" onClick={() => setConfirmEquippedDiscard(null)}>
          <div className="max-w-sm w-full bg-gradient-to-br from-[#2a0a0a] to-[#1a0a2e] border-2 border-red-400/60 rounded-2xl shadow-2xl px-6 py-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-3xl mb-2">⚠️</div>
            <div className="text-red-300 font-extrabold text-lg mb-1">Abandonner un équipement équipé ?</div>
            <div className="text-amber-100/80 text-sm mb-4">
              Au moins un des équipements sélectionnés est actuellement <span className="font-bold text-amber-200">équipé</span>. L'abandonner le retirera de ton héros et il sera perdu définitivement.
            </div>
            <div className="flex gap-2">
              <button onClick={() => { const ids = confirmEquippedDiscard; setConfirmEquippedDiscard(null); doDiscard(ids); }}
                className="flex-1 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white">
                Oui, abandonner
              </button>
              <button onClick={() => setConfirmEquippedDiscard(null)}
                className="flex-1 py-2 rounded-lg text-sm font-bold bg-black/30 border border-amber-500/30 text-amber-200/70 hover:text-amber-100">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Boss loot — inventaire séparé, non équipable, stats au survol */}
      <div className="bg-[#1a0a2e]/60 border border-purple-500/30 rounded-xl p-6">
        <h3 className="text-purple-300 font-bold mb-3">🏆 Butin</h3>
        {bossLoot.length === 0 ? (
          <div className="text-purple-300/40 text-center py-4">Aucun objet de boss. Vainquez des boss pour en obtenir !</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(() => {
              // Regroupe les objets identiques (même nom + icône) en une seule carte
              // avec un compteur ×N, au lieu d'une carte par exemplaire.
              const groups: Record<string, { item: any; ids: string[]; count: number }> = {};
              for (const it of bossLoot) {
                const eff = parseItemEffects(it);
                const key = `${it.name}|${eff.__icon || it.icon || ''}`;
                if (!groups[key]) groups[key] = { item: it, ids: [], count: 0 };
                groups[key].ids.push(it.id);
                groups[key].count++;
              }
              return Object.values(groups).map(({ item, ids, count }) => {
              const effects = parseItemEffects(item);
              const icon = effects.__icon || item.icon;
              const source = effects.__source || item.source;
              const stats = formatItemStats(effects);
              return (
              <div key={ids[0]}
                title={stats ? `${item.name}\n${stats}` : item.name}
                className={`group relative bg-[#0d0520]/80 rounded-lg p-3 border ${RARITY_BG[item.rarity] || 'border-purple-500/30'} cursor-help`}>
                <div className="flex items-start gap-3">
                  <div className="relative h-14 w-14 shrink-0 rounded-lg border border-purple-500/20 bg-black/25 flex items-center justify-center overflow-hidden">
                    {icon ? <img src={icon} alt="" className="h-full w-full object-contain" /> : <span className="text-2xl">🏆</span>}
                    {count > 1 && (
                      <span className="absolute -bottom-1 -right-1 bg-purple-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 border border-purple-300/50">×{count}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className={`font-bold text-sm ${RARITY_COLORS[item.rarity]}`}>{item.name}</span>
                    <div className="text-purple-200/40 text-xs mt-1">
                      {item.rarity === 'rare' ? '⭐ Rare' : item.rarity === 'epic' ? '💎 Épique' : item.rarity === 'legendary' ? '🌟 Légendaire' : item.rarity === 'mythic' ? '🟠 Mythique' : item.rarity === 'supreme' ? '🔴 Suprême' : item.rarity === 'god' ? '⚡ GOD' : 'Commun'}
                      {' | '}Objet {count > 1 && <span className="text-purple-300 font-bold">(en stock : {count})</span>}
                    </div>
                    {source && <div className="text-purple-200/30 text-xs mt-1">Source : {source}</div>}
                    <div className="text-purple-200/30 text-[11px] mt-1 italic">Vendable depuis l'onglet Marché → Items.</div>
                  </div>
                </div>
                {stats && (
                  <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[220px] rounded-lg border border-purple-400/40 bg-[#0d0520] px-3 py-2 text-xs text-purple-100 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    <div className={`font-bold ${RARITY_COLORS[item.rarity]}`}>{item.name}</div>
                    <div className="text-purple-200/80 mt-0.5">{stats}</div>
                  </div>
                )}
              </div>
              );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BATTLE TROOP PICKER — sprite cards with quantity steppers
// ============================================================
// Construit une sélection = toutes les troupes disponibles au maximum.
function maxSelection(troops: any[]): Record<string, number> {
  const byType: Record<string, number> = {};
  troops.forEach((t: any) => { byType[t.type] = (byType[t.type] || 0) + (t.count || 0); });
  const sel: Record<string, number> = {};
  for (const [type, c] of Object.entries(byType)) if (c > 0) sel[type] = c;
  return sel;
}

// Borne une sélection au stock réel disponible (jamais plus que le max,
// supprime les types qui n'existent plus). Évite d'envoyer plus de troupes
// qu'on en possède après un combat.
function clampSelection(selected: Record<string, number>, troops: any[]): Record<string, number> {
  const byType: Record<string, number> = {};
  troops.forEach((t: any) => { byType[t.type] = (byType[t.type] || 0) + (t.count || 0); });
  const out: Record<string, number> = {};
  for (const [type, want] of Object.entries(selected || {})) {
    const have = byType[type] || 0;
    const v = Math.min(want || 0, have);
    if (v > 0) out[type] = v;
  }
  return out;
}

// Signature du stock de troupes (type:count) pour détecter un changement (ex. après combat).
function troopsSignature(troops: any[]): string {
  const byType: Record<string, number> = {};
  troops.forEach((t: any) => { byType[t.type] = (byType[t.type] || 0) + (t.count || 0); });
  return Object.entries(byType).sort().map(([k, v]) => `${k}:${v}`).join(',');
}

function BattleTroopPicker({ troops, selected, onChange }: {
  troops: any[];
  selected: Record<string, number>;
  onChange: (fn: any) => void;
}) {
  // Agrège par type (le store peut avoir plusieurs lignes du même type).
  const byType: Record<string, number> = {};
  troops.forEach((t: any) => { byType[t.type] = (byType[t.type] || 0) + (t.count || 0); });
  const list = Object.entries(byType).filter(([, c]) => c > 0);

  if (list.length === 0) {
    return <div className="text-amber-500/50 text-sm py-2">Aucune troupe disponible. Recrute d'abord des unités.</div>;
  }
  const set = (type: string, n: number, max: number) =>
    onChange((prev: any) => ({ ...prev, [type]: Math.min(max, Math.max(0, n)) }));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {list.map(([type, count]) => {
        const d = TROOP_DATA[type];
        const val = selected[type] || 0;
        const active = val > 0;
        return (
          <div key={type} className={`relative rounded-lg border p-2 overflow-hidden transition-all ${active ? 'border-amber-400/70 bg-amber-500/10' : 'border-amber-500/15'}`}>
            {d && <div className={`absolute inset-0 bg-gradient-to-br ${d.accent} opacity-10 pointer-events-none`} />}
            <div className="relative flex items-center gap-2">
              <div className="shrink-0 w-12 h-14 flex items-end justify-center">
                {d ? <SpriteAnimation sprite={d.sprite} height={52} mode={active ? 'attack' : 'idle'} trigger={val} />
                   : <span className="text-2xl">{TROOP_ICONS[type] || '🗡️'}</span>}
              </div>
              <div className="min-w-0">
                <div className="text-amber-200 text-xs font-bold truncate">{TROOP_NAMES[type] || type}</div>
                <div className="text-amber-500/40 text-[10px]">dispo : {count}</div>
                <div className={`text-[11px] font-bold ${active ? 'text-amber-300' : 'text-amber-500/40'}`}>sélection : {val}</div>
              </div>
            </div>
            <div className="relative flex items-center gap-1 mt-2">
              <button type="button" onClick={() => set(type, val - 1, count)} className="w-6 h-6 rounded bg-[#0d0520] border border-amber-500/30 text-amber-300 text-sm leading-none hover:bg-amber-500/20">−</button>
              <input
                type="number" min={0} max={count} value={val}
                onChange={(e) => set(type, parseInt(e.target.value) || 0, count)}
                className="flex-1 w-full h-6 text-center bg-[#0d0520] border border-amber-500/30 rounded text-amber-100 text-xs focus:outline-none focus:border-amber-400"
              />
              <button type="button" onClick={() => set(type, val + 1, count)} className="w-6 h-6 rounded bg-[#0d0520] border border-amber-500/30 text-amber-300 text-sm leading-none hover:bg-amber-500/20">+</button>
              <button type="button" onClick={() => set(type, count, count)} className="px-1.5 h-6 rounded bg-[#0d0520] border border-amber-500/30 text-amber-400/70 text-[10px] hover:bg-amber-500/20">max</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// CRAFT TAB — enchantements (HDV 5)
// ============================================================
const ENCHANT_STAT_LABELS: Record<string, string> = {
  attack: 'Attaque', defense: 'Défense', hp: 'PV', magic: 'Magie', speed: 'Vitesse', crit: 'Critique', crit_mult: 'Mult. critique',
};
const ENCHANT_STAT_ICONS: Record<string, string> = {
  attack: '⚔️', defense: '🛡️', hp: '❤️', magic: '✨', speed: '💨', crit: '🎯', crit_mult: '💥',
};
// Valeur de stat ajoutée par niveau d'enchant (miroir du serveur ENCHANT_PER_LEVEL).
const ENCHANT_VALUE_PER_LEVEL: Record<string, number> = {
  attack: 20, defense: 20, hp: 50, magic: 20, speed: 20, crit: 20, crit_mult: 0.1,
};
const enchantTotal = (stat: string, level: number) => {
  const total = (ENCHANT_VALUE_PER_LEVEL[stat] ?? 1) * (Number(level) || 0);
  // Le multiplicateur de critique s'affiche en ×0.x (décimal), pas en entier.
  return stat === 'crit_mult' ? `×${total.toFixed(2)}` : total;
};

function itemIcon(item: any): string {
  try { const e = JSON.parse(item.effects || '{}'); return e.__icon || ''; } catch { return ''; }
}

// Provenance lisible d'un objet de craft, déduite de son icône.
//   /items/boss_item_NN.png  → Boss #N (onglet Boss)
//   /campaign_items/N.png    → Boss du chapitre N (onglet Campagne)
function itemProvenance(icon: string): string {
  let m = icon.match(/boss_item_(\d+)\.png/);
  if (m) return `Onglet Boss — Boss #${parseInt(m[1], 10)}`;
  m = icon.match(/campaign_items\/(\d+)\.png/);
  if (m) return `Onglet Campagne — Boss du chapitre ${parseInt(m[1], 10)}`;
  return 'Provenance inconnue';
}

function CraftTab({ emit }: { emit: any }) {
  const { player, resources, inventory } = useGameStore();
  const [recipes, setRecipes] = useState<Record<string, any> | null>(null);
  const [potions, setPotions] = useState<Record<string, any> | null>(null);
  const [perLevel, setPerLevel] = useState<Record<string, number>>({});
  const [activeBuffs, setActiveBuffs] = useState<Record<string, number>>({});
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [enchantPickerOpen, setEnchantPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  const refreshRecipes = () => {
    emit('get_enchant_recipes', {}, (res: any) => {
      if (res?.success) {
        setRecipes(res.recipes);
        setPotions(res.potions || null);
        setPerLevel(res.perLevel || {});
        setActiveBuffs(res.activeBuffs || {});
      }
    });
  };
  useEffect(() => { refreshRecipes(); }, []);
  // Rafraîchit l'affichage du compte à rebours des potions chaque seconde.
  useEffect(() => { const t = setInterval(() => forceTick(x => x + 1), 1000); return () => clearInterval(t); }, []);

  const enchants: Record<string, number> = player?.enchants || {};
  const gold = Math.floor(resources?.gold || 0);

  // Compte les items possédés par icône (pour vérifier les recettes).
  const ownedByIcon: Record<string, number> = {};
  (inventory || []).forEach((it: any) => { const ic = itemIcon(it); if (ic) ownedByIcon[ic] = (ownedByIcon[ic] || 0) + 1; });

  // Équipements enchantables : armor_* uniquement, jamais le butin de boss.
  const enchantable = (inventory || []).filter((it: any) => String(it.item_type).startsWith('armor') && !isBossItem(it));
  const selectedItem = enchantable.find((it: any) => it.id === selectedItemId) || enchantable[0];

  const craft = (stat: string) => {
    setBusy(true);
    emit('craft_enchant', { stat }, (res: any) => {
      setBusy(false);
      if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Craft impossible' });
      else useGameStore.getState().addNotification({ type: 'success', message: `Enchantement ${ENCHANT_STAT_LABELS[stat]} crafté !` });
    });
  };
  const craftPotion = (id: string) => {
    setBusy(true);
    emit('craft_potion', { id }, (res: any) => {
      setBusy(false);
      if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Potion impossible' });
      else {
        if (res.activeBuffs) setActiveBuffs(res.activeBuffs);
        useGameStore.getState().addNotification({ type: 'success', message: `${potions?.[id]?.label || 'Potion'} activée !` });
      }
    });
  };
  const craftGod = () => {
    setBusy(true);
    emit('craft_god_armor', {}, (res: any) => {
      setBusy(false);
      if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Forge GOD impossible' });
      else useGameStore.getState().addNotification({ type: 'success', message: 'Armure GOD forgée ! 🌟' });
    });
  };
  const craftGodSetPiece = (slot: string) => {
    setBusy(true);
    emit('craft_god_set_piece', { slot }, (res: any) => {
      setBusy(false);
      if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Forge impossible' });
      else useGameStore.getState().addNotification({ type: 'success', message: 'Pièce du Set GOD forgée ! ⚡' });
    });
  };
  const apply = (stat: string) => {
    if (!selectedItem) return;
    setBusy(true);
    emit('apply_enchant', { itemId: selectedItem.id, stat }, (res: any) => {
      setBusy(false);
      if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Application impossible' });
      else useGameStore.getState().addNotification({ type: 'success', message: `${ENCHANT_STAT_LABELS[stat]} appliqué sur ${selectedItem.name}` });
    });
  };

  const STATS = ['attack', 'defense', 'hp', 'magic', 'speed', 'crit', 'crit_mult'];

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-1" style={{ fontFamily: 'serif' }}>⚒️ Atelier de Craft</h2>
        <p className="text-amber-200/50 text-sm">Disponible dès le début. Crée des enchantements, des potions temporaires et l'armure GOD avec les objets des boss (onglets Boss et Campagne) et de l'or.</p>
      </div>

      {/* Craft des enchantements */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-400 font-bold mb-3">🔨 Crafter des enchantements</h3>
        {!recipes ? (
          <div className="text-amber-500/50 text-center py-4">Chargement des recettes…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {STATS.map(stat => {
              const r = recipes[stat];
              if (!r) return null;
              const goldOk = gold >= r.gold;
              const itemsOk = (r.items || []).every((req: any) => (ownedByIcon[req.icon] || 0) >= req.qty);
              const canCraft = goldOk && itemsOk && !busy;
              return (
                <div key={stat} className="bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-amber-300 font-bold text-sm">{ENCHANT_STAT_ICONS[stat]} Enchant. {ENCHANT_STAT_LABELS[stat]}</div>
                    <div className="text-amber-200/60 text-xs">En stock : <span className="text-amber-200 font-bold">{enchants[stat] || 0}</span></div>
                  </div>
                  <div className="text-amber-200/70 text-xs mb-1">Effet : {stat === 'crit_mult' ? `multiplicateur de critique ×${(perLevel[stat] ?? 0.1).toFixed(2)}` : `+${perLevel[stat] ?? 1} ${ENCHANT_STAT_LABELS[stat]}`} par niveau</div>

                  {/* Coût items */}
                  <div className="space-y-1 mb-1">
                    {(r.items || []).map((req: any) => {
                      const have = ownedByIcon[req.icon] || 0;
                      const ok = have >= req.qty;
                      return (
                        <div key={req.icon} className="group relative flex items-center gap-2 text-xs">
                          <img src={req.icon} alt="" title={itemProvenance(req.icon)} className="h-7 w-7 object-contain rounded bg-black/30 border border-amber-500/20 cursor-help" />
                          <span className={ok ? 'text-amber-100/80' : 'text-red-400'}>{have}/{req.qty} objet(s) de boss</span>
                          <div className="pointer-events-none absolute left-0 bottom-full mb-1 w-max max-w-[200px] rounded-lg border border-amber-400/40 bg-[#0d0520] px-2 py-1 text-[11px] text-amber-100 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
                            📍 {itemProvenance(req.icon)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Coût or */}
                  <div className={`text-xs mb-2 ${goldOk ? 'text-amber-100/80' : 'text-red-400'}`}>💰 {r.gold.toLocaleString()} or</div>

                  <button disabled={!canCraft} onClick={() => craft(stat)}
                    className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${canCraft ? 'bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-50' : 'bg-[#0d0520] border border-amber-500/10 text-amber-500/30 cursor-not-allowed'}`}>
                    Crafter
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Appliquer sur un équipement */}
      <div className="bg-[#1a0a2e]/60 border border-purple-500/30 rounded-xl p-6">
        <h3 className="text-purple-300 font-bold mb-3">✨ Appliquer sur un équipement</h3>
        {enchantable.length === 0 ? (
          <div className="text-purple-300/40 text-center py-4">Aucun équipement. Obtiens-en au combat d'abord.</div>
        ) : (
          <>
            {(() => {
              const selEffects = selectedItem ? parseItemEffects(selectedItem) : {};
              return (
                <button onClick={() => setEnchantPickerOpen(true)}
                  className="w-full mb-3 flex items-center gap-3 bg-[#0d0520] border border-purple-500/30 rounded-lg px-3 py-2 text-left hover:border-purple-400 transition-all">
                  <div className="h-10 w-10 shrink-0 rounded border border-purple-500/20 bg-black/30 flex items-center justify-center overflow-hidden">
                    {selEffects.__icon ? <img src={selEffects.__icon} alt="" className="h-full w-full object-contain" /> : <span className="text-xl">🛡️</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    {selectedItem ? (
                      <>
                        <div className={`text-sm font-bold truncate ${RARITY_COLORS[selectedItem.rarity] || 'text-amber-200'}`}>{selectedItem.name} {selectedItem.equipped ? '(équipé)' : ''}</div>
                        <div className="text-purple-200/40 text-xs">{SLOT_LABELS[selectedItem.item_type] || selectedItem.item_type} — clique pour changer</div>
                      </>
                    ) : <span className="text-purple-200/50 text-sm">Sélectionner un équipement…</span>}
                  </div>
                  <span className="text-purple-300/60 text-xs shrink-0">Choisir ▸</span>
                </button>
              );
            })()}

            {selectedItem && (() => {
              let applied: Record<string, number> = {};
              try { applied = JSON.parse(selectedItem.effects || '{}').__enchants || {}; } catch {}
              return (
                <>
                  <div className="text-purple-200/60 text-xs mb-2">
                    Enchantements actuels : {Object.keys(applied).length === 0 ? <span className="text-purple-200/40">aucun</span> :
                      <span className="text-fuchsia-400 font-semibold">{Object.entries(applied).map(([s, n]) => `✦ ${ENCHANT_STAT_LABELS[s] || s} +${enchantTotal(s, n as number)}`).join(' · ')}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {STATS.map(stat => {
                      const avail = enchants[stat] || 0;
                      const canApply = avail > 0 && !busy;
                      return (
                        <button key={stat} disabled={!canApply} onClick={() => apply(stat)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${canApply ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-200' : 'bg-black/20 text-purple-300/30 cursor-not-allowed'}`}>
                          {ENCHANT_STAT_ICONS[stat]} {ENCHANT_STAT_LABELS[stat]} ({avail})
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-purple-200/40 text-[11px] mt-2">Vitesse et Critique sont craftables mais le héros n'utilise pas ces stats — elles n'augmentent pas ses caractéristiques.</p>
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* MODALE : choix de l'équipement à enchanter */}
      {enchantPickerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4" onClick={() => setEnchantPickerOpen(false)}>
          <div className="max-w-2xl w-full max-h-[80vh] overflow-y-auto bg-[#1a0a2e] border-2 border-purple-400/50 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-purple-300 font-bold">🛡️ Choisis l'équipement à enchanter</h3>
              <button onClick={() => setEnchantPickerOpen(false)} className="text-purple-200/60 hover:text-white text-sm font-bold">✕</button>
            </div>
            {enchantable.length === 0 ? (
              <div className="text-purple-500/50 text-center py-6">Aucun équipement.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {enchantable.map((it: any) => {
                  const eff = parseItemEffects(it);
                  let applied: Record<string, number> = {};
                  try { applied = eff.__enchants || {}; } catch {}
                  const isSel = selectedItem?.id === it.id;
                  return (
                    <button key={it.id}
                      onClick={() => { setSelectedItemId(it.id); setEnchantPickerOpen(false); }}
                      className={`text-left bg-[#0d0520]/80 rounded-lg p-2 border transition-all hover:border-purple-400 ${isSel ? 'border-purple-400 ring-1 ring-purple-400/40' : (RARITY_BG[it.rarity] || 'border-purple-500/20')}`}>
                      <div className="flex items-center justify-center h-14 mb-1 relative">
                        {eff.__icon ? <img src={eff.__icon} alt="" className="h-14 w-14 object-contain" /> : <span className="text-3xl">🛡️</span>}
                        {it.equipped && <span className="absolute -top-1 -right-1 bg-green-600 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center border border-green-300/60">✓</span>}
                      </div>
                      <div className={`text-xs font-bold truncate ${RARITY_COLORS[it.rarity]}`}>{it.name}</div>
                      <div className="text-purple-200/40 text-[11px] truncate">{SLOT_LABELS[it.item_type] || it.item_type}</div>
                      {Object.keys(applied).length > 0 && (
                        <div className="text-fuchsia-400 text-[11px] truncate">✦ {Object.entries(applied).map(([s, n]) => `${ENCHANT_STAT_LABELS[s] || s}+${enchantTotal(s, n as number)}`).join(' ')}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="bg-[#1a0a2e]/60 border border-emerald-500/30 rounded-xl p-6">
        <h3 className="text-emerald-300 font-bold mb-1">🧪 Potions (buffs temporaires)</h3>
        <p className="text-emerald-200/50 text-xs mb-3">Craft dès le début avec de l'or + un objet de boss. Effet limité dans le temps. Recraft pour prolonger.</p>
        {!potions ? (
          <div className="text-emerald-500/50 text-center py-4">Chargement…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.values(potions).map((p: any) => {
              const goldOk = gold >= p.gold;
              const itemsOk = (p.items || []).every((req: any) => (ownedByIcon[req.icon] || 0) >= req.qty);
              const canCraft = goldOk && itemsOk && !busy;
              const now = Math.floor(Date.now() / 1000);
              const expires = activeBuffs[p.id] || 0;
              const remaining = Math.max(0, expires - now);
              const active = remaining > 0;
              const mm = Math.floor(remaining / 60), ss = remaining % 60;
              return (
                <div key={p.id} className={`bg-[#0d0520]/80 rounded-lg p-3 border ${active ? 'border-emerald-400/60 ring-1 ring-emerald-400/30' : 'border-emerald-500/20'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-emerald-200 font-bold text-sm">{p.icon} {p.label}</div>
                    {active && <span className="text-emerald-300 text-[11px] font-bold">⏳ {mm}:{String(ss).padStart(2, '0')}</span>}
                  </div>
                  <div className="text-emerald-200/70 text-xs mb-2">{p.desc}</div>
                  <div className="space-y-1 mb-1">
                    {(p.items || []).map((req: any) => {
                      const have = ownedByIcon[req.icon] || 0;
                      const ok = have >= req.qty;
                      return (
                        <div key={req.icon} className="group relative flex items-center gap-2 text-xs">
                          <img src={req.icon} alt="" title={itemProvenance(req.icon)} className="h-7 w-7 object-contain rounded bg-black/30 border border-emerald-500/20 cursor-help" />
                          <span className={ok ? 'text-emerald-100/80' : 'text-red-400'}>{have}/{req.qty} objet(s) de boss</span>
                          <div className="pointer-events-none absolute left-0 bottom-full mb-1 w-max max-w-[200px] rounded-lg border border-emerald-400/40 bg-[#0d0520] px-2 py-1 text-[11px] text-emerald-100 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
                            📍 {itemProvenance(req.icon)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className={`text-xs mb-2 ${goldOk ? 'text-emerald-100/80' : 'text-red-400'}`}>💰 {p.gold.toLocaleString()} or</div>
                  <button disabled={!canCraft} onClick={() => craftPotion(p.id)}
                    className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${canCraft ? 'bg-gradient-to-r from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-emerald-50' : 'bg-[#0d0520] border border-emerald-500/10 text-emerald-500/30 cursor-not-allowed'}`}>
                    {active ? 'Prolonger' : 'Crafter & activer'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ARMURE GOD */}
      <div className="bg-gradient-to-br from-[#2a1a05]/80 to-[#1a0a2e]/60 border border-yellow-400/40 rounded-xl p-6">
        <h3 className="text-yellow-300 font-bold mb-1">⚡ Forger l'Armure GOD</h3>
        <p className="text-yellow-200/60 text-xs mb-3">L'armure la plus puissante du jeu. Recette : 1 objet de CHACUN des 40 boss de la Tour + 1 objet de CHAQUE boss de campagne + 100 000 or. Stats colossales (≈ +25000 ATK, +50000 PV).</p>
        {(() => {
          const TOWER_ICONS = Array.from({ length: 40 }, (_, i) => `/items/boss_item_${String(i + 1).padStart(2, '0')}.png`);
          const CAMPAIGN_COUNT = 10;
          const CAMPAIGN_ICONS = Array.from({ length: CAMPAIGN_COUNT }, (_, i) => `/campaign_items/${i + 1}.png`);
          const goldOk = gold >= 100000;
          const allIcons = [...TOWER_ICONS, ...CAMPAIGN_ICONS];
          const itemsOk = allIcons.every(ic => (ownedByIcon[ic] || 0) >= 1);
          const canCraft = goldOk && itemsOk && !busy;
          const ownedTower = TOWER_ICONS.filter(ic => (ownedByIcon[ic] || 0) >= 1).length;
          const ownedCampaign = CAMPAIGN_ICONS.filter(ic => (ownedByIcon[ic] || 0) >= 1).length;
          return (
            <>
              <div className="text-yellow-200/60 text-xs mb-1">Boss de la Tour : <span className={ownedTower === 40 ? 'text-yellow-100 font-bold' : 'text-yellow-200/80 font-bold'}>{ownedTower}/40</span></div>
              <div className="flex flex-wrap gap-2 mb-3">
                {TOWER_ICONS.map((ic, i) => {
                  const ok = (ownedByIcon[ic] || 0) >= 1;
                  return (
                    <div key={ic} className="group relative flex items-center gap-1 text-xs">
                      <img src={ic} alt="" title={itemProvenance(ic)} className={`h-8 w-8 object-contain rounded bg-black/30 border cursor-help ${ok ? 'border-yellow-400/40' : 'border-red-500/30 opacity-40'}`} />
                      <div className="pointer-events-none absolute left-0 bottom-full mb-1 w-max max-w-[220px] rounded-lg border border-yellow-400/40 bg-[#0d0520] px-2 py-1 text-[11px] text-yellow-100 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
                        📍 Boss Tour #{i + 1} — {itemProvenance(ic)}{ok ? '' : ' (manquant)'}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-yellow-200/60 text-xs mb-1">Boss de campagne : <span className={ownedCampaign === CAMPAIGN_COUNT ? 'text-yellow-100 font-bold' : 'text-yellow-200/80 font-bold'}>{ownedCampaign}/{CAMPAIGN_COUNT}</span></div>
              <div className="flex flex-wrap gap-2 mb-3">
                {CAMPAIGN_ICONS.map((ic, i) => {
                  const ok = (ownedByIcon[ic] || 0) >= 1;
                  return (
                    <div key={ic} className="group relative flex items-center gap-1 text-xs">
                      <img src={ic} alt="" title={itemProvenance(ic)} className={`h-8 w-8 object-contain rounded bg-black/30 border cursor-help ${ok ? 'border-orange-400/50' : 'border-red-500/30 opacity-40'}`} />
                      <div className="pointer-events-none absolute left-0 bottom-full mb-1 w-max max-w-[220px] rounded-lg border border-orange-400/40 bg-[#0d0520] px-2 py-1 text-[11px] text-orange-100 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
                        📍 Boss de campagne — Chapitre {i + 1}{ok ? '' : ' (manquant)'}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={`text-xs mb-2 ${goldOk ? 'text-yellow-100/80' : 'text-red-400'}`}>💰 100 000 or</div>
              <button disabled={!canCraft} onClick={craftGod}
                className={`w-full py-2 rounded-lg text-sm font-bold transition-all ${canCraft ? 'bg-gradient-to-r from-yellow-500 to-amber-700 hover:from-yellow-400 hover:to-amber-600 text-black' : 'bg-[#0d0520] border border-yellow-400/10 text-yellow-400/30 cursor-not-allowed'}`}>
                ⚡ Forger l'Armure GOD
              </button>
            </>
          );
        })()}
      </div>

      {/* COLLECTION — SET GOD COMPLET (8 pièces) */}
      <div className="bg-gradient-to-br from-[#2a1205]/80 to-[#1a0a2e]/60 border-2 border-yellow-400/50 rounded-xl p-6">
        <h3 className="text-yellow-300 font-bold mb-1">👑 Collection — Set GOD complet</h3>
        <p className="text-yellow-200/60 text-xs mb-3">8 pièces (une par emplacement), chacune colossale. Coût par pièce : <span className="text-yellow-100 font-bold">100 000 000 d'or</span> + 1 objet de CHACUN des 40 boss de la Tour + 1 objet de boss de campagne du <span className="text-orange-200 font-bold">chapitre 10</span>. Porter les 8 active aussi le bonus de set (+5% critique).</p>
        {(() => {
          const SLOTS = [
            { slot: 'helmet', name: 'Casque', icon: '/armor/armor_1_1.png' },
            { slot: 'shoulders', name: 'Épaulières', icon: '/armor/armor_1_2.png' },
            { slot: 'gloves', name: 'Gants', icon: '/armor/armor_1_3.png' },
            { slot: 'chest', name: 'Plastron', icon: '/armor/armor_1_4.png' },
            { slot: 'boots', name: 'Bottes', icon: '/armor/armor_1_5.png' },
            { slot: 'shield', name: 'Bouclier', icon: '/armor/armor_1_6.png' },
            { slot: 'bracers', name: 'Brassards', icon: '/armor/armor_1_7.png' },
            { slot: 'relic', name: 'Relique', icon: '/armor/armor_1_8.png' },
          ];
          const TOWER_ICONS = Array.from({ length: 40 }, (_, i) => `/items/boss_item_${String(i + 1).padStart(2, '0')}.png`);
          const CAMPAIGN_ICON = '/campaign_items/10.png';
          const ownedSlots = new Set<string>();
          (inventory || []).forEach((it: any) => { try { const e = JSON.parse(it.effects || '{}'); if (e.__set === 'set_god' && e.__slot) ownedSlots.add(e.__slot); } catch {} });
          const ownedTower = TOWER_ICONS.filter(ic => (ownedByIcon[ic] || 0) >= 1).length;
          const campaignOk = (ownedByIcon[CAMPAIGN_ICON] || 0) >= 1;
          const goldOk = gold >= 100000000;
          const itemsOk = ownedTower === 40 && campaignOk;
          return (
            <>
              <div className="text-yellow-200/70 text-sm mb-3">Collection : <span className="text-yellow-100 font-bold">{ownedSlots.size}/8 pièces</span></div>
              <div className="text-yellow-200/60 text-xs mb-1">Boss de la Tour : <span className={ownedTower === 40 ? 'text-yellow-100 font-bold' : 'text-yellow-200/80 font-bold'}>{ownedTower}/40</span> · Campagne ch.10 : <span className={campaignOk ? 'text-yellow-100 font-bold' : 'text-red-400 font-bold'}>{campaignOk ? 'ok' : 'manquant'}</span></div>
              <div className={`text-xs mb-3 ${goldOk ? 'text-yellow-100/80' : 'text-red-400'}`}>💰 100 000 000 or par pièce {goldOk ? '' : `(tu as ${gold.toLocaleString()})`}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SLOTS.map(s => {
                  const owned = ownedSlots.has(s.slot);
                  const canCraft = !owned && goldOk && itemsOk && !busy;
                  return (
                    <div key={s.slot} className={`rounded-lg p-2 border text-center ${owned ? 'border-green-400/50 bg-green-500/10' : 'border-yellow-400/25 bg-black/20'}`}>
                      <img src={s.icon} alt="" className={`h-12 w-12 mx-auto object-contain ${owned ? '' : 'opacity-70'}`} />
                      <div className="text-yellow-200/80 text-xs font-bold mt-1">{s.name}</div>
                      {owned ? (
                        <div className="text-green-400 text-xs font-bold mt-1">✓ Obtenue</div>
                      ) : (
                        <button disabled={!canCraft} onClick={() => craftGodSetPiece(s.slot)}
                          className={`mt-1 w-full py-1 rounded text-xs font-bold transition-all ${canCraft ? 'bg-gradient-to-r from-yellow-500 to-amber-700 hover:from-yellow-400 text-black' : 'bg-[#0d0520] border border-yellow-400/10 text-yellow-400/30 cursor-not-allowed'}`}>
                          ⚡ Forger
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {ownedSlots.size === 8 && <div className="mt-3 text-center text-green-300 font-bold">👑 Set GOD complet ! Bonus de set actif.</div>}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ============================================================
// CAMPAIGN TAB
// ============================================================
function CampaignTab({ emit }: { emit: any }) {
  const { campaign, troops, hero } = useGameStore();
  const [selectedChapter, setSelectedChapter] = useState(campaign?.chapter || 1);
  const [selectedTroops, setSelectedTroops] = useState<Record<string, number>>({});
  const [battleLoading, setBattleLoading] = useState(false);
  // Mode de campagne : 'army' (par défaut) ou 'hero' (héros seul).
  const [mode, setMode] = useState<'army' | 'hero'>('army');
  const [heroInfo, setHeroInfo] = useState<any>(null);
  const [heroChapter, setHeroChapter] = useState(1);

  useEffect(() => { emit('hero_campaign_info', {}, (r: any) => { if (r?.success) { setHeroInfo(r); setHeroChapter(r.progress?.chapter || 1); } }); }, []);

  // Re-remplit le sélecteur au maximum dès que le stock de troupes change
  // (au chargement et après chaque combat).
  const sig = troopsSignature(troops);
  useEffect(() => { setSelectedTroops(maxSelection(troops)); }, [sig]);

  const chapters = Array.from({ length: 10 }, (_, i) => i + 1);

  // ---- Combat de la campagne HÉROS SEUL ----
  const heroEnemyFrames = ['/hero_campaign_enemy/h1.png', '/hero_campaign_enemy/h2.png', '/hero_campaign_enemy/h3.png'];
  const handleHeroBattle = (chapter: number, episode: number) => {
    setBattleLoading(true);
    emit('hero_campaign_setup', { chapter, episode }, (res: any) => {
      setBattleLoading(false);
      if (!res?.success) { useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); return; }
      const su = res.setup;
      const state = initCombat({ hero: su.heroStats, heroSkillLevels: su.skillLevels, troops: [], enemyTroops: [], enemyHero: su.enemyHero, enemyLabel: su.label });
      useGameStore.setState({ pendingBattle: {
        state, scene: 'forest', allyTypes: [], originalTroops: [],
        applyEvent: 'hero_campaign_battle', applyData: { chapter, episode },
        bossIndex: null, enemyFrames: heroEnemyFrames, chapter,
        onApplied: () => { emit('hero_campaign_info', {}, (r: any) => { if (r?.success) setHeroInfo(r); }); },
      }});
    });
  };

  const handleBattle = (chapter: number, episode: number) => {
    setBattleLoading(true);
    const allyTypes = Object.keys(selectedTroops).filter(k => (selectedTroops[k] || 0) > 0);
    const originalTroops = allyTypes.map(type => {
      const t = troops.find((x: any) => x.type === type);
      return { type, count: selectedTroops[type], level: t?.level || 1 };
    });
    emit('battle_setup', { mode: 'campaign', chapter, episode }, (res: any) => {
      setBattleLoading(false);
      if (!res?.success) { useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); return; }
      const su = res.setup;
      const state = initCombat({
        hero: su.heroStats,
        heroSkillLevels: su.skillLevels,
        troops: originalTroops,
        enemyTroops: su.enemyTroops,
        enemyHero: su.enemyHero,
        enemyLabel: su.label,
      });
      useGameStore.setState({ pendingBattle: {
        state, scene: 'forest', allyTypes, originalTroops,
        applyEvent: 'campaign_battle', applyData: { chapter, episode, troops: selectedTroops },
        bossIndex: null,
        chapter, isBoss: episode === 10,
      }});
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-4" style={{ fontFamily: 'serif' }}>📜 Campagne Solo</h2>

        {/* Choix du mode : Armée (par défaut) ou Héros seul */}
        {heroInfo?.enabled && (
          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode('army')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition-all ${mode === 'army' ? 'bg-amber-500/25 border-amber-400 text-amber-100' : 'bg-black/20 border-amber-500/20 text-amber-200/60'}`}>⚔️ Avec l'armée</button>
            <button onClick={() => setMode('hero')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition-all ${mode === 'hero' ? 'bg-purple-500/25 border-purple-400 text-purple-100' : 'bg-black/20 border-purple-500/20 text-purple-200/60'}`}>🦸 Héros seul</button>
          </div>
        )}

        {mode === 'hero' && heroInfo?.enabled ? (
          <>
            <p className="text-purple-200/60 text-sm mb-4">Duels héros contre un ennemi unique. Équilibré et exigeant. C'est ici qu'on gagne le plus d'<span className="text-amber-300 font-bold">XP de héros</span> et beaucoup de renommée — plus tu avances, plus les gains explosent. Progression : Chapitre {heroInfo.progress?.chapter}, Épisode {heroInfo.progress?.episode}.</p>
            {chapters.map(ch => (
              <div key={ch} className="mb-4">
                <h3 className="text-purple-300 font-bold mb-2 cursor-pointer flex items-center gap-2"
                  onClick={() => setHeroChapter(heroChapter === ch ? 0 : ch)}>
                  <span>{heroChapter === ch ? '▼' : '▶'}</span>
                  Chapitre {ch} {ch < (heroInfo.progress?.chapter || 1) ? '✅' : ch === (heroInfo.progress?.chapter || 1) ? '🔄' : '🔒'}
                </h3>
                {heroChapter === ch && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 ml-4">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(ep => {
                      const unlocked = ch < (heroInfo.progress?.chapter || 1) || (ch === (heroInfo.progress?.chapter || 1) && ep <= (heroInfo.progress?.episode || 1));
                      return (
                        <button key={ep} onClick={() => unlocked && handleHeroBattle(ch, ep)} disabled={!unlocked || battleLoading}
                          className={`w-full p-2 rounded-lg text-center transition-all text-sm border ${unlocked ? 'border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 cursor-pointer text-purple-200' : 'border-purple-500/10 bg-[#0d0520]/50 opacity-40 cursor-not-allowed text-purple-500/30'}`}>
                          <div className="text-lg">🦸</div>
                          <div className="text-xs">Ép. {ep}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </>
        ) : (
          <>
        <p className="text-amber-200/50 text-sm mb-4">Progression: Chapitre {campaign?.chapter}, Épisode {campaign?.episode}</p>

        {/* Troop Selection */}
        <div className="mb-6 bg-[#0d0520]/80 rounded-lg p-4 border border-amber-500/20">
          <h3 className="text-amber-300 font-bold text-sm mb-3">Sélection des troupes</h3>
          <BattleTroopPicker troops={troops} selected={selectedTroops} onChange={setSelectedTroops} />
        </div>

        {/* Chapters */}
        {chapters.map(ch => (
          <div key={ch} className="mb-4">
            <h3 className="text-amber-300 font-bold mb-2 cursor-pointer flex items-center gap-2"
              onClick={() => setSelectedChapter(selectedChapter === ch ? 0 : ch)}>
              <span>{selectedChapter === ch ? '▼' : '▶'}</span>
              Chapitre {ch} {ch < (campaign?.chapter || 1) ? '✅' : ch === (campaign?.chapter || 1) ? '🔄' : '🔒'}
            </h3>
            {selectedChapter === ch && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 ml-4">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(ep => {
                  const unlocked = ch < (campaign?.chapter || 1) || (ch === (campaign?.chapter || 1) && ep <= (campaign?.episode || 1));
                  const isBoss = ep === 10;
                  return (
                    <div key={ep} className="relative group">
                    <button
                      onClick={() => unlocked && handleBattle(ch, ep)}
                      disabled={!unlocked || battleLoading}
                      className={`w-full p-2 rounded-lg text-center transition-all text-sm ${
                        isBoss ? 'border-2 border-red-500/50 bg-red-900/20' : 'border border-amber-500/20'
                      } ${
                        unlocked
                          ? 'bg-amber-500/10 hover:bg-amber-500/20 cursor-pointer text-amber-300'
                          : 'bg-[#0d0520]/50 opacity-40 cursor-not-allowed text-amber-500/30'
                      }`}
                    >
                      <div className="text-lg">{isBoss ? '👑' : '⚔️'}</div>
                      <div className="text-xs">Ép. {ep}</div>
                    </button>
                    {isBoss && (
                      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[200px] rounded-lg border border-red-400/40 bg-[#0d0520] px-3 py-2 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-30">
                        <div className="flex items-center gap-2">
                          <img src={campaignBossItemIcon(ch)} alt="" className="h-12 w-12 object-contain rounded bg-black/30 border border-red-400/20" />
                          <div className="min-w-0">
                            <div className="text-[11px] text-amber-200/45">Objet du boss</div>
                            <div className="text-xs font-bold text-amber-200 leading-tight">{campaignBossItemName(ch)}</div>
                          </div>
                        </div>
                        <div className="text-[11px] text-green-300/90 font-bold mt-1">🎁 Chance de drop : 100%</div>
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// TOWER TAB
// ============================================================
function TowerTab({ emit }: { emit: any }) {
  const { tower, troops, combatResult, towerMultipliers } = useGameStore() as any;
  const MULTS: number[] = (Array.isArray(towerMultipliers) && towerMultipliers.length) ? towerMultipliers : [1, 2, 3, 5, 10, 15, 25];
  const [multiplier, setMultiplier] = useState(1);
  const [selectedTroops, setSelectedTroops] = useState<Record<string, number>>({});
  const [battleLoading, setBattleLoading] = useState(false);
  // Troupes encore vivantes dans la run en cours (null = pas de run active).
  const [runTroops, setRunTroops] = useState<Record<string, number> | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  const sig = troopsSignature(troops);
  useEffect(() => { setSelectedTroops(maxSelection(troops)); }, [sig]);

  // Étage de progression PROPRE au multiplicateur choisi.
  const floorsByMult: Record<string, number> = (() => {
    try { return JSON.parse((tower as any)?.floors_by_mult || '{}'); } catch { return {}; }
  })();
  const currentMultFloor = floorsByMult[String(multiplier)] || 0;

  const resetMultiplier = () => {
    if (runAlive) return;
    emit('tower_reset', { multiplier }, (res: any) => {
      if (res?.success) useGameStore.getState().addNotification({ type: 'success', message: `Multiplicateur x${multiplier} remis à l'étage 0.` });
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };

  const fight = (troopsToSend: Record<string, number>) => {
    setBattleLoading(true);
    const allyTypes = Object.keys(troopsToSend).filter(k => (troopsToSend[k] || 0) > 0);
    const originalTroops = allyTypes.map(type => {
      const t = troops.find((x: any) => x.type === type);
      return { type, count: troopsToSend[type], level: t?.level || 1 };
    });
    emit('battle_setup', { mode: 'tower', multiplier }, (res: any) => {
      setBattleLoading(false);
      if (!res?.success) { useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); return; }
      const su = res.setup;
      const state = initCombat({
        hero: su.heroStats, heroSkillLevels: su.skillLevels,
        troops: originalTroops, enemyTroops: su.enemyTroops, enemyHero: su.enemyHero, enemyLabel: su.label,
      });
      useGameStore.setState({ pendingBattle: {
        state, scene: 'tower', allyTypes, originalTroops,
        applyEvent: 'tower_battle', applyData: { troops: troopsToSend, multiplier }, bossIndex: null,
        towerFloor: currentMultFloor + 1,
        onApplied: (r: any) => {
          const survivors = r.result.survivingTroops || {};
          const totalAlive = Object.values(survivors).reduce((a: number, b: any) => a + (b || 0), 0);
          setLastResult({ ...r.result, floor: r.floor });
          setRunTroops(r.result.victory && totalAlive > 0 ? survivors : null);
        },
      }});
    });
  };

  const startRun = () => fight(selectedTroops);
  const nextFloor = () => { if (runTroops) fight(runTroops); };
  const modifyTroops = () => { setRunTroops(null); setLastResult(null); };

  const runAlive = runTroops && Object.values(runTroops).some(v => (v || 0) > 0);

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-2" style={{ fontFamily: 'serif' }}>🗼 Tour Infinie</h2>
        <p className="text-amber-200/50 text-sm mb-1">
          Étage actuel (x{multiplier}): {currentMultFloor} | Meilleur global: {tower?.best_floor || 0}
        </p>
        <p className="text-amber-200/40 text-xs mb-4">
          Chaque multiplicateur a sa PROPRE progression d'étages. Enchaîne les étages avec la même armée ; la run s'arrête à la mort de toutes les troupes. Tu peux remettre un multiplicateur à zéro à tout moment.
        </p>

        {/* Multiplicateur : verrouillé pendant une run pour cohérence */}
        <div className="mb-4">
          <label className="text-amber-300 text-sm font-bold block mb-2">Multiplicateur de difficulté:</label>
          <div className="flex flex-wrap gap-2">
            {MULTS.map(m => (
              <button
                key={m}
                onClick={() => !runAlive && setMultiplier(m)}
                disabled={!!runAlive}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                  multiplier === m
                    ? 'bg-amber-500/30 border-amber-400 text-amber-300 border'
                    : 'bg-[#0d0520] border-amber-500/20 text-amber-500/60 border hover:text-amber-300'
                } ${runAlive ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                x{m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="text-amber-200/60 text-sm">
              Progression x{multiplier} : <b className="text-amber-300">étage {currentMultFloor}</b>
            </span>
            <button
              onClick={resetMultiplier}
              disabled={!!runAlive || currentMultFloor < 10}
              title={currentMultFloor < 10 ? 'Reset possible seulement à partir de l\'étage 10' : ''}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                runAlive || currentMultFloor < 10
                  ? 'opacity-40 cursor-not-allowed bg-[#0d0520] border-red-500/20 text-red-400/50'
                  : 'bg-red-900/40 border-red-500/40 text-red-300 hover:bg-red-800/50'
              }`}
            >
              ♻️ Remettre x{multiplier} à 0{currentMultFloor < 10 ? ' (étage 10 min)' : ''}
            </button>
          </div>
        </div>

        {!runAlive ? (
          <>
            {/* Sélection des troupes hors run */}
            <div className="mb-4 bg-[#0d0520]/80 rounded-lg p-4 border border-amber-500/20">
              <h3 className="text-amber-300 font-bold text-sm mb-3">Sélection des troupes</h3>
              <BattleTroopPicker troops={troops} selected={selectedTroops} onChange={setSelectedTroops} />
            </div>
            <button
              onClick={startRun}
              disabled={battleLoading || Object.values(selectedTroops).every(v => v === 0)}
              className="bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600 hover:to-purple-800 text-amber-100 px-8 py-3 rounded-lg font-bold transition-all shadow-lg shadow-purple-900/30 disabled:opacity-50"
            >
              {battleLoading ? 'Combat en cours...' : `🗼 Attaquer l'étage ${currentMultFloor + 1} (x${multiplier})`}
            </button>
          </>
        ) : (
          <>
            {/* Run active : troupes survivantes + boutons suivant / modifier */}
            <div className="mb-4 bg-[#0d0520]/80 rounded-lg p-4 border border-green-500/30">
              <h3 className="text-green-300 font-bold text-sm mb-2">Troupes survivantes</h3>
              <div className="flex flex-wrap gap-3 text-sm">
                {Object.entries(runTroops!).filter(([, c]) => (c || 0) > 0).map(([type, c]) => (
                  <span key={type} className="text-amber-200">
                    {TROOP_ICONS?.[type] || '⚔️'} {TROOP_NAMES?.[type] || type}: <b className="text-green-300">{c}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={nextFloor}
                disabled={battleLoading}
                className="bg-gradient-to-r from-green-700 to-green-900 hover:from-green-600 hover:to-green-800 text-amber-100 px-6 py-3 rounded-lg font-bold transition-all shadow-lg shadow-green-900/30 disabled:opacity-50"
              >
                {battleLoading ? 'Combat...' : `▶️ Étage suivant (${(tower?.current_floor || 0) + 1}) avec les mêmes troupes`}
              </button>
              <button
                onClick={modifyTroops}
                disabled={battleLoading}
                className="bg-[#0d0520] border border-amber-500/30 hover:border-amber-400 text-amber-300 px-6 py-3 rounded-lg font-bold transition-all disabled:opacity-50"
              >
                🔧 Modifier les troupes
              </button>
            </div>
          </>
        )}

        {/* Fin de run : toutes les troupes mortes */}
        {lastResult && !runAlive && runTroops !== null && (
          <div className="mt-4 text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            💀 Toutes tes troupes sont tombées. Recompose une armée pour repartir.
          </div>
        )}
      </div>

      {/* Multiplayer co-op (1-4 players) */}
      <PartyPanel emit={emit} mode="tower" target={(tower?.current_floor || 0) + 1} label={`Étage ${(tower?.current_floor || 0) + 1}`} />
    </div>
  );
}

// ============================================================
// BOSS GAUNTLET TAB — 40 escalating bosses, solo or co-op
// ============================================================

// Libellés de rareté FR pour les objets de boss.
const ITEM_RARITY_LABEL: Record<string, string> = {
  common: 'Commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire',
};

// Stats lisibles d'un objet de boss.
function bossItemStatsText(it: BossItem): string {
  return Object.entries(it.effects)
    .map(([k, v]) => `+${v} ${STAT_LABELS[k] || k}`)
    .join(' • ');
}

// Carte détaillée de l'objet lâché par un boss (panneau de détail).
function BossDropCard({ it }: { it: BossItem }) {
  return (
    <div className={`rounded-lg p-3 border ${RARITY_BG[it.rarity] || 'border-gray-600'} bg-[#0d0520]/80 flex items-center gap-3`}>
      <div className="h-14 w-14 shrink-0 rounded-lg border border-amber-500/20 bg-black/30 flex items-center justify-center overflow-hidden">
        <img src={it.icon} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0">
        <div className={`font-bold text-sm ${RARITY_COLORS[it.rarity]}`}>{it.name}</div>
        <div className="text-amber-200/45 text-xs">
          {ITEM_RARITY_LABEL[it.rarity]} | {SLOT_LABELS[it.slot] || it.slot}
        </div>
        <div className="text-amber-200/70 text-xs mt-0.5">{bossItemStatsText(it)}</div>
        <div className="text-green-300/90 text-xs mt-0.5 font-bold">🎁 Chance de drop : {it.dropChance}%</div>
      </div>
    </div>
  );
}

// Info-bulle compacte au survol d'un boss (grille).
function BossDropTooltip({ it }: { it: BossItem }) {
  return (
    <div className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 bottom-full mb-2 w-44 rounded-lg border border-amber-500/40 bg-[#0d0520] p-2 shadow-xl shadow-black/60 text-left">
      <div className="flex items-center gap-2">
        <img src={it.icon} alt="" className="h-9 w-9 object-contain shrink-0 rounded bg-black/30 border border-amber-500/20" />
        <div className="min-w-0">
          <div className={`text-xs font-bold truncate ${RARITY_COLORS[it.rarity]}`}>{it.name}</div>
          <div className="text-[10px] text-amber-200/45">{ITEM_RARITY_LABEL[it.rarity]} | {SLOT_LABELS[it.slot] || it.slot}</div>
        </div>
      </div>
      <div className="text-[10px] text-amber-200/70 mt-1">{bossItemStatsText(it)}</div>
      <div className="text-[10px] text-green-300/90 font-bold mt-0.5">🎁 Drop : {it.dropChance}%</div>
    </div>
  );
}

function BossTab({ emit }: { emit: any }) {
  const { boss, troops } = useGameStore();
  const highest = boss?.highest_boss || 0;
  const [selectedBoss, setSelectedBoss] = useState<number | null>(null);
  const [bossMult, setBossMult] = useState<number>(1);
  const [hoverBoss, setHoverBoss] = useState<number | null>(null);
  const [selectedTroops, setSelectedTroops] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [dailyBoss, setDailyBoss] = useState<any>(null);
  useEffect(() => { emit('daily_boss', {}, (res: any) => { if (res?.success) setDailyBoss(res); }); }, []);

  const sig = troopsSignature(troops);
  useEffect(() => { setSelectedTroops(maxSelection(troops)); }, [sig, selectedBoss]);

  const unlockedMax = Math.min(40, highest + 1);

  const fight = () => {
    if (!selectedBoss) return;
    setLoading(true);
    // Sécurité : on borne la sélection au stock réel (jamais plus que le max).
    const safeSelected = clampSelection(selectedTroops, troops);
    const allyTypes = Object.keys(safeSelected).filter(k => (safeSelected[k] || 0) > 0);
    const originalTroops = allyTypes.map(type => {
      const t = troops.find((x: any) => x.type === type);
      return { type, count: safeSelected[type], level: t?.level || 1 };
    });
    emit('battle_setup', { mode: 'boss', bossIndex: selectedBoss, multiplier: bossMult }, (res: any) => {
      setLoading(false);
      if (!res?.success) { useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); return; }
      const su = res.setup;
      const state = initCombat({
        hero: su.heroStats, heroSkillLevels: su.skillLevels,
        troops: originalTroops, enemyTroops: su.enemyTroops, enemyHero: su.enemyHero, enemyLabel: su.label,
      });
      useGameStore.setState({ pendingBattle: {
        state, scene: 'tower', allyTypes, originalTroops,
        applyEvent: 'boss_battle', applyData: { bossIndex: selectedBoss, troops: safeSelected, multiplier: bossMult },
        bossIndex: su.bossIndex || selectedBoss,
        onApplied: (res: any) => {
          if (res?.result?.victory && !res.dailyBoss && !res?.result?.specialDrop && (res.pityBonus || 0) > 0) {
            useGameStore.getState().addNotification({ type: 'info', message: `🎯 Pas de butin signature. Chance augmentée : +${res.pityBonus}% au prochain combat de ce boss aujourd'hui.` });
          }
        },
      }});
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-1" style={{ fontFamily: 'serif' }}>👹 Gauntlet des Boss</h2>
        <p className="text-amber-200/50 text-sm mb-4">
          40 boss de difficulté croissante. Vaincs-les dans l'ordre — chacun est plus redoutable. Jouable en solo ou à 1–4 joueurs.
          {' '}Progression : <span className="text-amber-300 font-bold">{highest}/40</span>
        </p>

        {/* Boss grid */}
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
          {Array.from({ length: 40 }, (_, k) => k + 1).map(idx => {
            const locked = idx > unlockedMax;
            const beaten = idx <= highest;
            const active = selectedBoss === idx;
            const diff = bossDifficultyLabel(idx);
            const diffColor = idx <= 8 ? 'text-green-400' : idx <= 18 ? 'text-amber-400' : idx <= 28 ? 'text-orange-400' : idx <= 36 ? 'text-red-400' : 'text-fuchsia-400';
            return (
              <button
                key={idx}
                disabled={locked}
                onClick={() => { setSelectedBoss(idx); }}
                onMouseEnter={() => setHoverBoss(idx)}
                onMouseLeave={() => setHoverBoss((h) => (h === idx ? null : h))}
                className={`relative rounded-lg border p-1.5 transition-all ${
                  active ? 'border-amber-400 ring-2 ring-amber-400/50' : beaten ? 'border-green-600/40' : locked ? 'border-amber-500/10 opacity-40' : 'border-amber-500/25 hover:border-amber-400/60'
                }`}
                title={locked ? 'Verrouillé' : BOSS_NAMES[idx - 1]}
              >
                <div className="relative h-16 flex items-center justify-center">
                  <img src={`/bosses/boss_${idx}.png`} alt="" className="max-h-16 w-auto object-contain"
                    style={{ filter: locked ? 'grayscale(1) brightness(.5)' : 'drop-shadow(0 2px 3px rgba(0,0,0,.5))' }} />
                  {locked && <span className="absolute text-2xl">🔒</span>}
                  {beaten && <span className="absolute top-0 right-0 text-green-400 text-sm">✓</span>}
                  {dailyBoss?.bossIndex === idx && !locked && <span className="absolute top-0 left-0 text-base" title="Boss du jour">⭐</span>}
                </div>
                <div className="text-[10px] text-amber-200/80 font-bold truncate">#{idx}</div>
                <div className={`text-[9px] ${diffColor} truncate`}>{diff}</div>
                {hoverBoss === idx && !locked && bossItem(idx) && (
                  <BossDropTooltip it={bossItem(idx)!} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected boss detail */}
      {selectedBoss && (
        <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <img src={`/bosses/boss_${selectedBoss}.png`} alt="" className="h-24 w-auto object-contain" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.6))' }} />
            <div>
              <div className="text-amber-300 font-bold text-xl" style={{ fontFamily: 'serif' }}>#{selectedBoss} — {BOSS_NAMES[selectedBoss - 1]}</div>
              <div className="text-sm text-amber-200/60">Difficulté : {bossDifficultyLabel(selectedBoss)}</div>
              {selectedBoss > unlockedMax && <div className="text-red-400 text-sm">Verrouillé — battez le boss précédent</div>}
              {dailyBoss?.bossIndex === selectedBoss && (
                <div className="mt-1 inline-flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-500/20 border border-green-400/40 text-green-200">⭐ Boss du jour · drop ×2</span>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 border border-amber-400/40 text-amber-200">🏆 ×{dailyBoss.renownMult}</span>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-500/20 border border-blue-400/40 text-blue-200">📦 ×{dailyBoss.resourceMult}</span>
                </div>
              )}
            </div>
          </div>

          {/* Objet signature lâché par ce boss */}
          {bossItem(selectedBoss) && (
            <div className="mb-4">
              <h3 className="text-amber-300 font-bold text-sm mb-2">🎁 Butin signature</h3>
              <BossDropCard it={bossItem(selectedBoss)!} />
            </div>
          )}

          {/* Multiplicateur de boss : combattre N boss identiques en UN seul
              combat. Les stats du boss ET les récompenses sont multipliées par N. */}
          <div className="mb-4 bg-[#0d0520]/80 rounded-lg p-4 border border-red-500/25">
            <h3 className="text-red-300 font-bold text-sm mb-1">✖️ Multiplicateur de boss</h3>
            <p className="text-amber-200/45 text-xs mb-3">
              Affronte plusieurs fois le même boss en un seul combat. Ses stats (PV, attaque…) et ses récompenses sont multipliées par le multiplicateur. Ex. 1000 PV en ×5 → 5000 PV.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {[1, 2, 3, 5, 10, 25, 50, 100].map(m => (
                <button key={m} onClick={() => setBossMult(m)}
                  className={`px-3 py-1 rounded-lg text-sm font-bold transition-all border ${bossMult === m ? 'bg-red-500/30 border-red-400 text-red-100' : 'bg-black/20 border-amber-500/20 text-amber-200/60 hover:text-amber-100'}`}>
                  ×{m}
                </button>
              ))}
              <span className="w-px h-5 bg-amber-500/20" />
              <label className="text-amber-200/50 text-xs">Perso. :</label>
              <input type="number" min={1} max={1000} value={bossMult}
                onChange={(e) => setBossMult(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                className="w-20 bg-[#0d0520] border border-red-500/30 rounded px-2 py-1 text-red-200 text-sm focus:outline-none focus:border-red-400" />
            </div>
          </div>

          <div className="mb-4 bg-[#0d0520]/80 rounded-lg p-4 border border-amber-500/20">
            <h3 className="text-amber-300 font-bold text-sm mb-3">Sélection des troupes (solo)</h3>
            <BattleTroopPicker troops={troops} selected={selectedTroops} onChange={setSelectedTroops} />
          </div>

          <button
            onClick={fight}
            disabled={loading || selectedBoss > unlockedMax || Object.values(selectedTroops).every(v => v === 0)}
            className="bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600 hover:to-red-800 text-amber-50 px-8 py-3 rounded-lg font-bold transition-all shadow-lg shadow-red-900/30 disabled:opacity-50"
          >
            {loading ? 'Combat en cours...' : `⚔️ Affronter ${BOSS_NAMES[selectedBoss - 1]}${bossMult > 1 ? ` ×${bossMult}` : ''} (solo)`}
          </button>

          {/* Multiplayer */}
          <PartyPanel emit={emit} mode="boss" target={selectedBoss} label={`Boss #${selectedBoss} — ${BOSS_NAMES[selectedBoss - 1]}`} locked={selectedBoss > unlockedMax} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// PARTY PANEL — 1-4 player co-op rooms (tower & boss)
// ============================================================
function PartyPanel({ emit, mode, target, label, locked }: {
  emit: any; mode: 'tower' | 'boss'; target: number; label: string; locked?: boolean;
}) {
  const { partyRoom, troops, towerMultipliers, friends, player } = useGameStore() as any;
  const PMULTS: number[] = (Array.isArray(towerMultipliers) && towerMultipliers.length) ? towerMultipliers : [1, 2, 3, 5, 10, 15, 25];
  const [myTroops, setMyTroops] = useState<Record<string, number>>({});
  const [mult, setMult] = useState(1);
  const [invitePickerOpen, setInvitePickerOpen] = useState(false);
  const inRoom = partyRoom && partyRoom.mode === mode;

  // À chaque changement d'étage (montée coop) ou de stock, on remet la
  // sélection au maximum des troupes disponibles.
  const roomTarget = partyRoom?.target;
  const sig = troopsSignature(troops);
  useEffect(() => { setMyTroops(maxSelection(troops)); }, [roomTarget, sig]);

  const create = () => emit('party_create', { mode, target, multiplier: mode === 'tower' ? mult : 1 }, (res: any) => { if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error }); });
  const invite = (friendName: string) => emit('party_invite', { roomId: partyRoom.roomId, friendName }, (res: any) => {
    if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Invitation impossible' });
    else useGameStore.getState().addNotification({ type: 'success', message: `Invitation envoyée à ${friendName}.` });
  });
  const kick = (targetId: string) => emit('party_kick', { roomId: partyRoom.roomId, targetId }, (res: any) => {
    if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Impossible de retirer' });
  });

  // Si l'hôte change de boss (target) alors qu'un salon boss est déjà ouvert,
  // on met à jour la cible du salon : le groupe affrontera ce nouveau boss.
  useEffect(() => {
    if (!inRoom || mode !== 'boss') return;
    if (partyRoom.target === target) return;
    const amTheHost = partyRoom.members?.length && partyRoom.members[0]?.isHost;
    if (!amTheHost) return;
    emit('party_set_target', { roomId: partyRoom.roomId, target }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, inRoom]);

  const leave = () => emit('party_leave', { roomId: partyRoom.roomId }, () => { useGameStore.getState().setPartyRoom(null); useGameStore.getState().setCoopBattle(null); });
  const contribute = () => emit('party_contribute', { roomId: partyRoom.roomId, troops: clampSelection(myTroops, troops) }, (res: any) => { if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error }); });
  const start = () => emit('party_begin', { roomId: partyRoom.roomId }, (res: any) => {
    if (!res?.success) { useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); return; }
    // L'arène coop s'ouvre via l'événement 'coop_begin' diffusé à tous les membres.
  });

  const isHost = inRoom && partyRoom.members?.some((m: any) => m.isHost && m.name === player?.username);

  return (
    <div className="mt-5 bg-[#0d0520]/70 border border-purple-500/30 rounded-xl p-5">
      <h3 className="text-purple-300 font-bold mb-1 flex items-center gap-2">👥 Multijoueur (1–4 joueurs)</h3>
      <p className="text-amber-200/40 text-xs mb-4">Affrontez {label} en équipe. Plus de joueurs = boss plus coriace mais récompenses pour tous.</p>

      {!inRoom ? (
        <div className="flex flex-wrap gap-3 items-end">
          {mode === 'tower' && (
            <div>
              <label className="text-amber-200/50 text-xs block mb-1">Multiplicateur (x récompenses & difficulté)</label>
              <div className="flex gap-1">
                {PMULTS.map(m => (
                  <button key={m} onClick={() => setMult(m)}
                    className={`px-3 py-2 rounded-lg text-sm font-bold border transition-all ${mult === m ? 'bg-purple-600 border-purple-400 text-white' : 'bg-[#0d0520] border-purple-500/30 text-amber-200/60 hover:border-purple-400'}`}>
                    x{m}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={create} disabled={locked}
            className="bg-gradient-to-r from-purple-700 to-purple-900 hover:from-purple-600 hover:to-purple-800 text-amber-50 px-5 py-2.5 rounded-lg font-bold disabled:opacity-50">
            ➕ Créer un salon
          </button>
          <div className="text-amber-200/40 text-xs self-center">Crée un salon, puis invite tes amis directement.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-amber-200">
              👥 Groupe <span className="text-amber-500/50 text-sm ml-1">({partyRoom.members?.length || 1}/{partyRoom.maxPlayers || 4})</span>
            </div>
            <div className="flex items-center gap-2">
              {isHost && (partyRoom.members?.length || 1) < (partyRoom.maxPlayers || 4) && (
                <button onClick={() => setInvitePickerOpen(true)}
                  className="bg-cyan-700/60 hover:bg-cyan-600 text-cyan-100 px-3 py-1.5 rounded-lg text-sm font-bold border border-cyan-500/30">
                  ➕ Inviter un ami
                </button>
              )}
              <button onClick={leave} className="text-red-400 hover:text-red-300 text-sm underline">Quitter</button>
            </div>
          </div>

          {/* Bandeau de progression (mode tour) */}
          {mode === 'tower' && (
            <div className="flex items-center justify-between flex-wrap gap-2 bg-gradient-to-r from-purple-900/40 to-[#1a0a2e]/40 border border-purple-500/25 rounded-lg px-4 py-2">
              <div className="text-amber-200 text-sm">
                🗼 Étage actuel <span className="font-bold text-amber-300">{partyRoom.target}</span>
                <span className="text-amber-500/50 ml-2">x{partyRoom.multiplier || 1} récompenses</span>
              </div>
              <div className="text-green-300/80 text-xs font-bold">
                {partyRoom.floorsCleared ? `✓ ${partyRoom.floorsCleared} étage(s) franchi(s)` : 'Aucun étage franchi'}
              </div>
            </div>
          )}

          {/* Members */}
          <div className="grid sm:grid-cols-2 gap-2">
            {partyRoom.members?.map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-[#1a0a2e]/60 border border-purple-500/20 rounded-lg px-3 py-2">
                <span className="text-amber-200 text-sm">{m.isHost ? '👑 ' : ''}{m.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${m.ready ? 'text-green-400' : 'text-amber-500/40'}`}>
                    {m.ready ? `✓ ${m.troopCount} troupes` : 'en attente'}
                  </span>
                  {isHost && !m.isHost && m.playerId && (
                    <button onClick={() => kick(m.playerId)} title="Retirer du groupe"
                      className="h-5 w-5 flex items-center justify-center rounded-full bg-red-600/70 hover:bg-red-500 text-white text-xs font-bold">✕</button>
                  )}
                </div>
              </div>
            ))}
            {Array.from({ length: Math.max(0, (partyRoom.maxPlayers || 4) - (partyRoom.members?.length || 0)) }).map((_, i) => (
              <div key={`e${i}`} className="bg-[#1a0a2e]/30 border border-dashed border-purple-500/15 rounded-lg px-3 py-2 text-amber-500/30 text-sm">Place libre…</div>
            ))}
          </div>

          {/* My contribution */}
          <div className="bg-[#1a0a2e]/50 rounded-lg p-3 border border-purple-500/20">
            <h4 className="text-amber-300 text-sm font-bold mb-2">Mes troupes engagées</h4>
            <BattleTroopPicker troops={troops} selected={myTroops} onChange={setMyTroops} />
            <button onClick={contribute} disabled={Object.values(myTroops).every(v => v === 0)}
              className="mt-3 bg-purple-800/60 hover:bg-purple-700 text-amber-100 px-4 py-2 rounded-lg text-sm font-bold border border-purple-500/30 disabled:opacity-40">
              ✓ Valider mes troupes
            </button>
          </div>

          {isHost && (
            <button onClick={start}
              className="w-full bg-gradient-to-r from-red-700 to-red-900 hover:from-red-600 hover:to-red-800 text-amber-50 py-3 rounded-lg font-bold shadow-lg shadow-red-900/30">
              {mode === 'tower'
                ? `⚔️ Combattre l'étage ${partyRoom.target} (${partyRoom.members?.filter((m: any) => m.ready).length || 0} prêt·s)`
                : `⚔️ Lancer le combat (${partyRoom.members?.filter((m: any) => m.ready).length || 0} prêt·s)`}
            </button>
          )}
          {!isHost && <div className="text-center text-amber-500/50 text-sm">En attente que l'hôte lance le combat… Une fois lancé, chaque joueur jouera son héros à son tour.</div>}
        </div>
      )}

      {/* MODALE : inviter un ami */}
      {invitePickerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4" onClick={() => setInvitePickerOpen(false)}>
          <div className="max-w-md w-full max-h-[75vh] overflow-y-auto bg-[#1a0a2e] border-2 border-cyan-400/50 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-cyan-300 font-bold">👥 Inviter un ami</h3>
              <button onClick={() => setInvitePickerOpen(false)} className="text-cyan-200/60 hover:text-white text-sm font-bold">✕</button>
            </div>
            {(!friends || friends.length === 0) ? (
              <div className="text-cyan-500/50 text-center py-6">Aucun ami. Ajoute des amis dans l'onglet Amis.</div>
            ) : (
              <div className="space-y-2">
                {friends.map((f: any) => {
                  const name = f.username || f.name || f;
                  const online = f.online !== false;
                  const already = partyRoom?.members?.some((m: any) => m.name === name);
                  return (
                    <div key={name} className="flex items-center justify-between bg-[#0d0520]/80 border border-cyan-500/20 rounded-lg px-3 py-2">
                      <span className="text-cyan-100 text-sm">{online ? '🟢' : '⚪'} {name}</span>
                      <button
                        disabled={already}
                        onClick={() => { invite(name); setInvitePickerOpen(false); }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${already ? 'bg-black/30 text-cyan-500/30 cursor-not-allowed' : 'bg-cyan-700/60 hover:bg-cyan-600 text-cyan-100'}`}>
                        {already ? 'Déjà là' : 'Inviter'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MARKET TAB
// ============================================================
type MarketFeedback = {
  type: 'success' | 'error';
  icon: string;
  title: string;
  message: string;
  amount?: string;
  id?: number;
};

function MarketFeedbackToast({ feedback, onClose }: { feedback: MarketFeedback | null; onClose: () => void }) {
  if (!feedback) return null;

  return (
    <div key={feedback.id} className="fixed top-5 right-5 z-50 w-[min(360px,calc(100vw-2rem))] animate-in slide-in-from-top-3 fade-in duration-300">
      <div className={`relative overflow-hidden rounded-2xl border p-4 shadow-2xl backdrop-blur-md ${
        feedback.type === 'success'
          ? 'border-amber-300/50 bg-gradient-to-br from-[#2b1604]/95 via-[#15081f]/95 to-[#062513]/95 shadow-amber-950/50'
          : 'border-red-400/50 bg-gradient-to-br from-[#2b0606]/95 via-[#15081f]/95 to-[#260606]/95 shadow-red-950/50'
      }`}>
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-amber-300/10 blur-2xl" />
        <div className="pointer-events-none absolute left-4 top-0 h-px w-28 bg-gradient-to-r from-transparent via-amber-200/70 to-transparent" />
        <div className="relative flex items-start gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-2xl ${
            feedback.type === 'success'
              ? 'border-amber-300/40 bg-amber-400/15 shadow-lg shadow-amber-900/30'
              : 'border-red-300/40 bg-red-400/15 shadow-lg shadow-red-900/30'
          }`}>
            {feedback.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className={feedback.type === 'success' ? 'text-amber-200 text-sm font-black uppercase tracking-wide' : 'text-red-200 text-sm font-black uppercase tracking-wide'}>
              {feedback.title}
            </div>
            <div className="mt-1 text-sm text-amber-100/80">{feedback.message}</div>
            {feedback.amount && (
              <div className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-extrabold ${
                feedback.type === 'success'
                  ? 'border-green-400/30 bg-green-500/10 text-green-300'
                  : 'border-red-400/30 bg-red-500/10 text-red-200'
              }`}>
                <span className={feedback.type === 'success' ? 'animate-bounce' : ''}>🪙</span>
                {feedback.amount}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-amber-200/50 transition-colors hover:bg-white/10 hover:text-amber-100"
            aria-label="Fermer la notification du marché"
          >
            ✕
          </button>
        </div>
        <div className={`mt-4 h-1 rounded-full ${feedback.type === 'success' ? 'bg-amber-300/20' : 'bg-red-300/20'}`}>
          <div className={`h-full rounded-full ${feedback.type === 'success' ? 'bg-gradient-to-r from-amber-300 to-green-300' : 'bg-gradient-to-r from-red-300 to-orange-300'} market-feedback-progress`} />
        </div>
      </div>
    </div>
  );
}

function MarketTab({ emit }: { emit: any }) {
  const { marketListings, resources, inventory, player } = useGameStore();
  const [sellMode, setSellMode] = useState<'resource' | 'equipment' | 'item'>('resource');
  const [listingFilter, setListingFilter] = useState<'all' | 'resources' | 'equipment' | 'item'>('all');
  const [sellResource, setSellResource] = useState('stone');
  const [sellAmount, setSellAmount] = useState(100);
  const [marketSellInfo, setMarketSellInfo] = useState<{ prices: Record<string, number>; multiplier: number; eventName?: string | null }>({ prices: RESOURCE_SELL_PRICES, multiplier: 1 });
  const [sellEquipmentId, setSellEquipmentId] = useState('');
  const [equipmentPrice, setEquipmentPrice] = useState(100);
  const [equipPickerOpen, setEquipPickerOpen] = useState(false);
  const [equipRarityFilter, setEquipRarityFilter] = useState<string>('all');
  // Vente d'objets de boss
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [selectedItemKey, setSelectedItemKey] = useState<string>('');
  const [itemQty, setItemQty] = useState(1);
  const [itemPrice, setItemPrice] = useState(1000);
  const [marketFeedback, setMarketFeedback] = useState<MarketFeedback | null>(null);
  const marketFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMarketFeedback = (feedback: MarketFeedback) => {
    if (marketFeedbackTimer.current) clearTimeout(marketFeedbackTimer.current);
    setMarketFeedback({ ...feedback, id: Date.now() });
    marketFeedbackTimer.current = setTimeout(() => setMarketFeedback(null), 3600);
  };

  useEffect(() => () => {
    if (marketFeedbackTimer.current) clearTimeout(marketFeedbackTimer.current);
  }, []);

  const refreshListings = (filter = listingFilter) => {
    const payload = filter === 'equipment' ? { listingType: 'equipment' } : filter === 'item' ? { listingType: 'item' } : {};
    emit('market_listings', payload, (res: any) => {
      if (res.success) useGameStore.getState().setMarketListings(res.listings);
    });
  };

  useEffect(() => {
    refreshListings('all');
    emit('market_sell_info', {}, (res: any) => {
      if (res.success) setMarketSellInfo({ prices: res.prices || RESOURCE_SELL_PRICES, multiplier: res.multiplier || 1, eventName: res.eventName });
    });
  }, []);

  // Équipements vendables = vrais équipements (PAS les objets de boss), non équipés.
  const sellableEquipment = inventory.filter((item: any) => item && !item.equipped && !isBossItem(item));
  const selectedEquipment = sellableEquipment.find((item: any) => item.id === sellEquipmentId) || sellableEquipment[0];

  // Objets de boss groupés par nom+effets, avec quantité possédée.
  const itemGroups = (() => {
    const g: Record<string, { ref: any; count: number; icon: string }> = {};
    for (const it of inventory) {
      if (!it || it.equipped || !isBossItem(it)) continue;
      const eff = parseItemEffects(it);
      const key = `${it.name}|${JSON.stringify(it.effects || '{}')}`;
      if (!g[key]) g[key] = { ref: it, count: 0, icon: eff.__icon || it.icon || '' };
      g[key].count++;
    }
    return g;
  })();
  const itemGroupList = Object.entries(itemGroups).map(([key, v]) => ({ key, ...v }));
  const selectedItemGroup = itemGroupList.find(g => g.key === selectedItemKey) || itemGroupList[0];

  const visibleListings = marketListings.filter((listing: any) => {
    const type = listing.listing_type || 'resource';
    if (listingFilter === 'resources') return type === 'resource';
    if (listingFilter === 'equipment') return type === 'equipment';
    if (listingFilter === 'item') return type === 'item';
    return true;
  });

  const selectedResourcePrice = marketSellInfo.prices?.[sellResource] || RESOURCE_SELL_PRICES[sellResource] || 0;
  const resourceSellMultiplier = marketSellInfo.multiplier || 1;
  const resourceGoldEarned = Math.floor((sellAmount || 0) * selectedResourcePrice * resourceSellMultiplier);

  const afterMarketAction = (feedback: MarketFeedback) => {
    showMarketFeedback(feedback);
    refreshListings();
    emit('market_sell_info', {}, (res: any) => {
      if (res.success) setMarketSellInfo({ prices: res.prices || RESOURCE_SELL_PRICES, multiplier: res.multiplier || 1, eventName: res.eventName });
    });
  };

  const showMarketError = (message: string) => {
    showMarketFeedback({
      type: 'error',
      icon: '⚠️',
      title: 'Action impossible',
      message: message || 'Une erreur est survenue au marché.',
    });
  };

  return (
    <div className="space-y-6 relative">
      <MarketFeedbackToast feedback={marketFeedback} onClose={() => setMarketFeedback(null)} />
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-4" style={{ fontFamily: 'serif' }}>🏪 Marché</h2>

        {/* Sell */}
        <div className="mb-6 bg-[#0d0520]/80 rounded-lg p-4 border border-amber-500/20">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="text-amber-300 font-bold text-sm">Vendre</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setSellMode('resource')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${sellMode === 'resource' ? 'bg-amber-500/30 text-amber-200' : 'bg-black/20 text-amber-200/50 hover:text-amber-200'}`}
              >
                Ressources
              </button>
              <button
                onClick={() => setSellMode('equipment')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${sellMode === 'equipment' ? 'bg-purple-500/30 text-purple-200' : 'bg-black/20 text-amber-200/50 hover:text-amber-200'}`}
              >
                Équipements
              </button>
              <button
                onClick={() => setSellMode('item')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${sellMode === 'item' ? 'bg-emerald-500/30 text-emerald-200' : 'bg-black/20 text-amber-200/50 hover:text-amber-200'}`}
              >
                Items
              </button>
            </div>
          </div>

          {sellMode === 'resource' ? (
            <div className="space-y-3">
              <div className="text-amber-200/55 text-xs bg-black/20 border border-amber-500/15 rounded-lg p-2">
                Les ressources ne créent plus d'offre : elles sont vendues automatiquement contre de l'or avec des prix fixes.
              </div>
              <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="text-amber-200/50 text-xs block mb-1">Ressource</label>
                <select value={sellResource} onChange={(e) => setSellResource(e.target.value)}
                  className="bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-2 text-amber-100 text-sm focus:outline-none focus:border-amber-400">
                  {SELLABLE_RESOURCES.map(r => (
                    <option key={r} value={r}>{RESOURCE_ICONS[r]} {RESOURCE_NAMES[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-amber-200/50 text-xs block mb-1">Quantité</label>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} value={sellAmount} onChange={(e) => setSellAmount(parseInt(e.target.value) || 1)}
                    className="bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-2 text-amber-100 w-20 text-sm focus:outline-none focus:border-amber-400" />
                  <button type="button" onClick={() => setSellAmount(Math.max(1, Math.floor(resources?.[sellResource] || 0)))}
                    className="px-2 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition-all">
                    MAX
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-black/20 px-3 py-2 text-xs">
                <div className="text-amber-200/50">Prix fixe</div>
                <div className="text-amber-200 font-bold">{selectedResourcePrice} or / unité</div>
              </div>
              <div className="rounded-lg border border-green-500/20 bg-green-950/20 px-3 py-2 text-xs">
                <div className="text-green-200/60">Gain immédiat</div>
                <div className="text-green-300 font-bold">+{resourceGoldEarned} or</div>
              </div>
              <div className="text-amber-200/40 text-xs pb-2">
                Possédé : {Math.floor(resources?.[sellResource] || 0)}
                {resourceSellMultiplier > 1 && (
                  <div className="text-green-300 mt-1">🎉 {marketSellInfo.eventName || 'Événement'} : vente x{resourceSellMultiplier}</div>
                )}
              </div>
              <button onClick={() => emit('market_sell', { listingType: 'resource', resourceType: sellResource, amount: sellAmount }, (res: any) => {
                if (res.success) {
                  const earned = res.goldEarned || resourceGoldEarned;
                  afterMarketAction({
                    type: 'success',
                    icon: RESOURCE_ICONS[sellResource] || '🪙',
                    title: 'Vente réussie',
                    message: `${Math.floor(sellAmount || 0)} ${RESOURCE_NAMES[sellResource] || 'ressources'} vendus instantanément au marché.`,
                    amount: `+${earned} or`,
                  });
                } else showMarketError(res.error);
              })}
                className="bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-100 px-4 py-2 rounded-lg text-sm font-bold transition-all">
                💰 Vendre contre or
              </button>
              </div>
            </div>
          ) : sellMode === 'equipment' ? (
            <div className="space-y-3">
              {sellableEquipment.length === 0 ? (
                <div className="text-amber-500/50 text-sm">Aucun équipement vendable. Les objets équipés ne sont pas proposés ici : déséquipe-les en équipant une autre pièce du même emplacement.</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="min-w-[260px] flex-1">
                      <label className="text-amber-200/50 text-xs block mb-1">Équipement sélectionné</label>
                      <button onClick={() => setEquipPickerOpen(true)}
                        className="flex items-center gap-2 w-full bg-[#0d0520] border border-purple-500/30 rounded-lg px-3 py-2 text-purple-100 text-sm hover:border-purple-400 transition-all">
                        {selectedEquipment ? (() => { const eff = parseItemEffects(selectedEquipment); return (
                          <>
                            {eff.__icon ? <img src={eff.__icon} alt="" className="h-6 w-6 object-contain" /> : <span>🛡️</span>}
                            <span className={`truncate ${RARITY_COLORS[selectedEquipment.rarity] || ''}`}>{selectedEquipment.name}</span>
                            <span className="text-purple-300/50 text-xs ml-auto">{SLOT_LABELS[selectedEquipment.item_type] || selectedEquipment.item_type}</span>
                          </>
                        ); })() : <span className="text-purple-200/50">Sélectionner un équipement…</span>}
                      </button>
                    </div>
                    <div>
                      <label className="text-amber-200/50 text-xs block mb-1">Prix total en or</label>
                      <input type="number" min={1} value={equipmentPrice} onChange={(e) => setEquipmentPrice(parseInt(e.target.value) || 1)}
                        className="bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-2 text-amber-100 w-32 text-sm focus:outline-none focus:border-amber-400" />
                    </div>
                    <button disabled={!selectedEquipment} onClick={() => emit('market_sell', { listingType: 'equipment', itemId: selectedEquipment?.id, pricePerUnit: equipmentPrice }, (res: any) => {
                      if (res.success) {
                        const soldEquipmentName = selectedEquipment?.name || 'Équipement';
                        setSellEquipmentId('');
                        afterMarketAction({
                          type: 'success',
                          icon: '🛡️',
                          title: 'Offre publiée',
                          message: `${soldEquipmentName} est maintenant visible dans les offres du marché.`,
                          amount: `${equipmentPrice} or`,
                        });
                      } else showMarketError(res.error);
                    })}
                      className="bg-gradient-to-r from-purple-700 to-amber-800 hover:from-purple-600 hover:to-amber-700 text-amber-100 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40">
                      🛡️ Vendre l'équipement
                    </button>
                  </div>
                  {selectedEquipment && (() => {
                    const effects = parseItemEffects(selectedEquipment);
                    return (
                      <div className={`rounded-lg p-3 border ${RARITY_BG[selectedEquipment.rarity] || 'border-gray-600'} bg-black/20 flex items-center gap-3`}>
                        <div className="h-12 w-12 rounded-lg border border-amber-500/20 bg-black/25 flex items-center justify-center overflow-hidden">
                          {effects.__icon ? <img src={effects.__icon} alt="" className="h-full w-full object-contain" /> : <span className="text-2xl">🛡️</span>}
                        </div>
                        <div>
                          <div className={`text-sm font-bold ${RARITY_COLORS[selectedEquipment.rarity]}`}>{selectedEquipment.name}</div>
                          <div className="text-amber-200/45 text-xs">{SLOT_LABELS[selectedEquipment.item_type] || selectedEquipment.item_type}</div>
                          <div className="text-xs"><ItemStatsDisplay effects={effects} /></div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {itemGroupList.length === 0 ? (
                <div className="text-amber-500/50 text-sm">Aucun objet de boss à vendre. Vaincs des boss pour en obtenir.</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div>
                      <label className="text-amber-200/50 text-xs block mb-1">Objet sélectionné</label>
                      <button onClick={() => setItemPickerOpen(true)}
                        className="flex items-center gap-2 bg-[#0d0520] border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-100 text-sm hover:border-emerald-400 transition-all min-w-[220px]">
                        {selectedItemGroup ? (
                          <>
                            {selectedItemGroup.icon ? <img src={selectedItemGroup.icon} alt="" className="h-6 w-6 object-contain" /> : <span>🏆</span>}
                            <span className="truncate">{selectedItemGroup.ref.name}</span>
                            <span className="text-emerald-300/60 text-xs">(x{selectedItemGroup.count})</span>
                          </>
                        ) : <span className="text-emerald-200/50">Sélectionner…</span>}
                      </button>
                    </div>
                    <div>
                      <label className="text-amber-200/50 text-xs block mb-1">Quantité</label>
                      <div className="flex items-center gap-1">
                        <input type="number" min={1} max={selectedItemGroup?.count || 1} value={itemQty}
                          onChange={(e) => setItemQty(Math.max(1, Math.min(selectedItemGroup?.count || 1, parseInt(e.target.value) || 1)))}
                          className="bg-[#0d0520] border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-100 w-24 text-sm focus:outline-none focus:border-emerald-400" />
                        <button type="button" onClick={() => setItemQty(selectedItemGroup?.count || 1)}
                          className="px-2 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 transition-all">
                          MAX
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-amber-200/50 text-xs block mb-1">Prix total (or)</label>
                      <input type="number" min={1} value={itemPrice} onChange={(e) => setItemPrice(parseInt(e.target.value) || 1)}
                        className="bg-[#0d0520] border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-100 w-32 text-sm focus:outline-none focus:border-emerald-400" />
                    </div>
                    <button
                      disabled={!selectedItemGroup}
                      onClick={() => emit('market_sell', { listingType: 'item', itemId: selectedItemGroup?.ref.id, amount: itemQty, pricePerUnit: itemPrice }, (res: any) => {
                        if (res.success) {
                          afterMarketAction({ type: 'success', icon: '🏆', title: 'Offre publiée', message: `${itemQty}× ${selectedItemGroup?.ref.name} en vente.`, amount: `${itemPrice} or` });
                          setSelectedItemKey(''); setItemQty(1);
                        } else showMarketError(res.error);
                      })}
                      className="bg-gradient-to-r from-emerald-700 to-amber-800 hover:from-emerald-600 hover:to-amber-700 text-emerald-50 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40">
                      🏆 Vendre l'objet
                    </button>
                  </div>
                  <div className="text-emerald-200/40 text-xs">Les objets de boss se vendent sans limite de nombre d'offres.</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Listings */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-amber-300 font-bold text-sm">Offres disponibles</h3>
          <div className="flex gap-2">
            {[
              { id: 'all', label: 'Tout' },
              { id: 'resources', label: 'Ressources' },
              { id: 'equipment', label: 'Équipements' },
              { id: 'item', label: 'Items' },
            ].map((f: any) => (
              <button key={f.id} onClick={() => { setListingFilter(f.id); refreshListings(f.id); }}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${listingFilter === f.id ? 'bg-amber-500/30 text-amber-200' : 'bg-black/20 text-amber-200/50 hover:text-amber-200'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {visibleListings.length === 0 ? (
          <div className="text-amber-500/50 text-center py-4">Aucune offre pour le moment</div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {visibleListings.map((listing: any) => {
              const lt = listing.listing_type || 'resource';
              const isEquipment = lt === 'equipment';
              const isItem = lt === 'item';
              const hasIcon = isEquipment || isItem;
              const effects = hasIcon ? parseItemEffects({ effects: listing.item_effects }) : {};
              const total = Math.floor((listing.amount || 1) * listing.price_per_unit);
              const isMine = player && listing.player_id === player.id;
              return (
                <div key={listing.id} className={`bg-[#0d0520]/80 rounded-lg p-3 border ${hasIcon ? (RARITY_BG[listing.item_rarity] || 'border-purple-500/40') : 'border-amber-500/20'} flex items-center justify-between gap-3`}>
                  <div className="flex items-center gap-3 min-w-0">
                    {hasIcon ? (
                      <div className="relative h-12 w-12 shrink-0 rounded-lg border border-amber-500/20 bg-black/25 flex items-center justify-center overflow-hidden">
                        {effects.__icon ? <img src={effects.__icon} alt="" className="h-full w-full object-contain" /> : <span className="text-2xl">{isItem ? '🏆' : '🛡️'}</span>}
                        {isItem && (listing.amount || 1) > 1 && (
                          <span className="absolute -bottom-1 -right-1 bg-emerald-600 text-white text-[10px] font-bold rounded-full px-1 border border-emerald-300/50">×{Math.floor(listing.amount)}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-lg">{RESOURCE_ICONS[listing.resource_type]}</span>
                    )}
                    <div className="min-w-0">
                      {hasIcon ? (
                        <>
                          <div className={`text-sm font-bold truncate ${RARITY_COLORS[listing.item_rarity] || 'text-amber-300'}`}>{listing.item_name}{isItem && (listing.amount || 1) > 1 ? ` ×${Math.floor(listing.amount)}` : ''}</div>
                          <div className="text-amber-500/40 text-xs">{isItem ? '🏆 Objet de boss' : (SLOT_LABELS[listing.item_type] || listing.item_type)} | par {listing.username}</div>
                          <div className="text-amber-200/65 text-xs">{formatItemStats(effects)}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-amber-300 text-sm">{Math.floor(listing.amount)} {RESOURCE_NAMES[listing.resource_type]}</div>
                          <div className="text-amber-500/40 text-xs">par {listing.username} | {listing.price_per_unit} or/unité</div>
                        </>
                      )}
                    </div>
                  </div>
                  {isMine ? (
                    <button
                      onClick={() => emit('market_cancel', { listingId: listing.id }, (res: any) => {
                        if (res.success) afterMarketAction({ type: 'success', icon: '↩️', title: 'Offre retirée', message: 'Le contenu est de retour dans ton inventaire.' });
                        else showMarketError(res.error);
                      })}
                      className="shrink-0 bg-red-700/40 hover:bg-red-700/60 text-red-200 px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                    >
                      ↩️ Retirer
                    </button>
                  ) : (
                    <button
                      onClick={() => emit('market_buy', { listingId: listing.id }, (res: any) => {
                        if (res.success) afterMarketAction({
                          type: 'success',
                          icon: isItem ? '🏆' : isEquipment ? '🛡️' : (RESOURCE_ICONS[listing.resource_type] || '🛒'),
                          title: 'Achat réussi',
                          message: hasIcon ? `${listing.item_name} ajouté à ton inventaire.` : `${Math.floor(listing.amount)} ${RESOURCE_NAMES[listing.resource_type] || 'ressources'} achetés.`,
                          amount: `-${total} or`,
                        });
                        else showMarketError(res.error);
                      })}
                      className="shrink-0 bg-green-700/50 hover:bg-green-700/70 text-green-300 px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                    >
                      Acheter ({total} or)
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODALE : choix de l'objet de boss à vendre */}
      {equipPickerOpen && (() => {
        const RARITIES = [
          { id: 'all', label: 'Toutes' },
          { id: 'common', label: 'Commun' },
          { id: 'rare', label: 'Rare' },
          { id: 'epic', label: 'Épique' },
          { id: 'legendary', label: 'Légendaire' },
          { id: 'mythic', label: 'Mythique' },
          { id: 'supreme', label: 'Suprême' },
          { id: 'god', label: 'GOD' },
        ];
        // Sélection par rareté : on ne propose JAMAIS un équipement équipé (déjà
        // exclu de sellableEquipment), et on filtre par la rareté choisie.
        const filtered = sellableEquipment.filter((it: any) => equipRarityFilter === 'all' || it.rarity === equipRarityFilter);
        // Compte par rareté pour n'afficher que les filtres utiles.
        const counts: Record<string, number> = {};
        for (const it of sellableEquipment) counts[it.rarity] = (counts[it.rarity] || 0) + 1;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4" onClick={() => setEquipPickerOpen(false)}>
            <div className="max-w-2xl w-full max-h-[80vh] overflow-y-auto bg-[#1a0a2e] border-2 border-purple-400/50 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-purple-300 font-bold">🛡️ Choisis un équipement à vendre</h3>
                <button onClick={() => setEquipPickerOpen(false)} className="text-purple-200/60 hover:text-white text-sm font-bold">✕</button>
              </div>
              {/* Filtre par rareté */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {RARITIES.filter(r => r.id === 'all' || (counts[r.id] || 0) > 0).map(r => (
                  <button key={r.id} onClick={() => setEquipRarityFilter(r.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${equipRarityFilter === r.id ? 'bg-purple-500/30 border-purple-400 text-purple-100' : 'bg-black/20 border-purple-500/20 text-purple-200/60 hover:text-purple-100'}`}>
                    {r.label}{r.id !== 'all' && counts[r.id] ? ` (${counts[r.id]})` : ''}
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className="text-purple-500/50 text-center py-6">Aucun équipement vendable pour cette rareté. Les équipements équipés ne sont pas proposés.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filtered.map((it: any) => {
                    const eff = parseItemEffects(it);
                    return (
                      <button key={it.id}
                        onClick={() => { setSellEquipmentId(it.id); setEquipPickerOpen(false); }}
                        className={`text-left bg-[#0d0520]/80 rounded-lg p-2 border transition-all hover:border-purple-400 ${RARITY_BG[it.rarity] || 'border-purple-500/20'}`}>
                        <div className="flex items-center justify-center h-14 mb-1">
                          {eff.__icon ? <img src={eff.__icon} alt="" className="h-14 w-14 object-contain" /> : <span className="text-3xl">🛡️</span>}
                        </div>
                        <div className={`text-xs font-bold truncate ${RARITY_COLORS[it.rarity]}`}>{it.name}</div>
                        <div className="text-purple-300/60 text-[11px]">{SLOT_LABELS[it.item_type] || it.item_type}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {itemPickerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4" onClick={() => setItemPickerOpen(false)}>
          <div className="max-w-2xl w-full max-h-[80vh] overflow-y-auto bg-[#1a0a2e] border-2 border-emerald-400/50 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-emerald-300 font-bold">🏆 Choisis un objet à vendre</h3>
              <button onClick={() => setItemPickerOpen(false)} className="text-emerald-200/60 hover:text-white text-sm font-bold">✕</button>
            </div>
            {itemGroupList.length === 0 ? (
              <div className="text-emerald-500/50 text-center py-6">Aucun objet de boss.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {itemGroupList.map((g) => (
                  <button key={g.key}
                    onClick={() => { setSelectedItemKey(g.key); setItemQty(1); setItemPickerOpen(false); }}
                    className={`text-left bg-[#0d0520]/80 rounded-lg p-2 border transition-all hover:border-emerald-400 ${RARITY_BG[g.ref.rarity] || 'border-emerald-500/20'}`}>
                    <div className="flex items-center justify-center h-14 mb-1">
                      {g.icon ? <img src={g.icon} alt="" className="h-14 w-14 object-contain" /> : <span className="text-3xl">🏆</span>}
                    </div>
                    <div className={`text-xs font-bold truncate ${RARITY_COLORS[g.ref.rarity]}`}>{g.ref.name}</div>
                    <div className="text-emerald-300/60 text-[11px]">En stock : {g.count}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// ============================================================
function ResearchTab({ emit }: { emit: any }) {
  const { research, resources } = useGameStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Miroir des coûts/temps serveur (RESEARCH_TYPES).
  const RESEARCH = [
    { id: 'mining_efficiency', name: 'Efficacité minière', icon: '⛏️', desc: '+5% production mines / niveau', max: 20, costMul: 1.5, baseTime: 3600, baseCost: { stone: 200, iron: 100, gold: 50, food: 0, wood: 50, magic_energy: 10 } },
    { id: 'farming_techniques', name: 'Techniques agricoles', icon: '🌾', desc: '+5% production fermes / niveau', max: 20, costMul: 1.5, baseTime: 3600, baseCost: { stone: 50, iron: 30, gold: 40, food: 0, wood: 200, magic_energy: 5 } },
    { id: 'forging_mastery', name: 'Maîtrise de la forge', icon: '🔥', desc: '+3% qualité équipements / niveau', max: 15, costMul: 1.6, baseTime: 7200, baseCost: { stone: 100, iron: 200, gold: 80, food: 0, wood: 50, magic_energy: 20 } },
    { id: 'military_tactics', name: 'Tactiques militaires', icon: '⚔️', desc: '+2% combat / niveau', max: 20, costMul: 1.5, baseTime: 5400, baseCost: { stone: 150, iron: 150, gold: 100, food: 100, wood: 50, magic_energy: 30 } },
    { id: 'arcane_studies', name: 'Études arcaniques', icon: '✨', desc: '+5% magie / niveau', max: 20, costMul: 1.6, baseTime: 5400, baseCost: { stone: 100, iron: 50, gold: 150, food: 0, wood: 100, magic_energy: 100 } },
    { id: 'fortification', name: 'Fortification', icon: '🏰', desc: '+5% défense village / niveau', max: 15, costMul: 1.5, baseTime: 7200, baseCost: { stone: 300, iron: 200, gold: 50, food: 0, wood: 200, magic_energy: 10 } },
  ];

  const fmtTime = (s: number) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}min`;
    if (m > 0) return `${m}min ${sec}s`;
    return `${sec}s`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-1" style={{ fontFamily: 'serif' }}>🔬 Recherches</h2>
        <p className="text-amber-200/40 text-sm mb-4">Lance une recherche à la fois par technologie. Le coût et le temps augmentent à chaque niveau.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {RESEARCH.map(r => {
            const existing = research?.find((x: any) => x.type === r.id);
            const level = existing?.level || 0;
            const now = Date.now() / 1000;
            const isActive = existing && existing.completion_time > now;
            const remaining = isActive ? existing.completion_time - now : 0;
            const progress = isActive ? Math.min(100, ((now - existing.start_time) / (existing.completion_time - existing.start_time)) * 100) : 0;

            // coût du PROCHAIN niveau
            const nextCost: Record<string, number> = {};
            for (const res of UPGRADE_RESOURCES) nextCost[res] = Math.floor((r.baseCost as any)[res] * Math.pow(r.costMul, level));
            const nextTime = Math.floor(r.baseTime * Math.pow(1.3, level));
            const maxed = level >= r.max;
            const affordable = resources && UPGRADE_RESOURCES.every(res => (resources[res] ?? 0) >= nextCost[res]);

            return (
              <div key={r.id} className="bg-[#0d0520]/80 rounded-lg p-4 border border-amber-500/20 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{r.icon}</span>
                  <div>
                    <div className="text-amber-300 font-bold text-sm">{r.name}</div>
                    <div className="text-amber-200/40 text-xs">{r.desc}</div>
                  </div>
                </div>
                <div className="text-amber-400 text-sm mb-2">Niveau {level}/{r.max}</div>

                {isActive ? (
                  <div className="mb-2">
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-blue-300 font-bold">⏳ En cours…</span>
                      <span className="text-amber-200/70">{fmtTime(remaining)} restant</span>
                    </div>
                    <div className="w-full bg-black/50 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                ) : !maxed ? (
                  <div className="mb-2 space-y-1">
                    <div className="text-amber-400/70 text-[11px]">Coût du niveau {level + 1} :</div>
                    <div className="flex flex-wrap gap-1.5">
                      {UPGRADE_RESOURCES.filter(res => nextCost[res] > 0).map(res => {
                        const ok = (resources?.[res] ?? Infinity) >= nextCost[res];
                        return (
                          <span key={res} className={`text-[11px] px-1.5 py-0.5 rounded border ${ok ? 'border-amber-500/20 text-amber-200' : 'border-red-500/50 text-red-400 bg-red-950/30'}`}>
                            {RESOURCE_ICONS[res]} {nextCost[res].toLocaleString()}
                          </span>
                        );
                      })}
                    </div>
                    <div className="text-amber-200/50 text-[11px]">⏱️ Durée : {fmtTime(nextTime)}</div>
                  </div>
                ) : null}

                <button
                  onClick={() => emit('start_research', { type: r.id }, (res: any) => {
                    if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
                    else useGameStore.getState().addNotification({ type: 'success', message: `Recherche lancée : ${r.name}` });
                  })}
                  disabled={maxed || isActive || !affordable}
                  className="mt-auto w-full bg-gradient-to-r from-blue-700 to-blue-900 hover:from-blue-600 hover:to-blue-800 text-amber-100 px-3 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                >
                  {isActive ? '⏳ En cours...' : maxed ? '✅ Niveau max' : affordable ? '🔬 Lancer la recherche' : 'Ressources insuffisantes'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// FRIENDS TAB
// ============================================================
function FriendsTab({ emit }: { emit: any }) {
  const { friends, friendsVersion, player } = useGameStore();
  const [addUsername, setAddUsername] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    emit('friends_list', {}, (res: any) => {
      if (res.success) useGameStore.getState().setFriends(res.friends || []);
    });
  };

  // Recharge au montage et à chaque événement ami (demande, acceptation, statut...).
  useEffect(() => { refresh(); }, [friendsVersion]);

  // Efface le message de retour après quelques secondes.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const sendRequest = () => {
    const name = addUsername.trim();
    if (!name) { setFeedback({ type: 'err', text: 'Entre un nom de joueur.' }); return; }
    if (player && name.toLowerCase() === (player.username || '').toLowerCase()) {
      setFeedback({ type: 'err', text: 'Tu ne peux pas t\'ajouter toi-même.' }); return;
    }
    setBusy(true);
    emit('friend_add', { username: name }, (res: any) => {
      setBusy(false);
      if (res.success) {
        setAddUsername('');
        setFeedback({ type: 'ok', text: `Demande envoyée à ${name}.` });
        refresh();
      } else {
        setFeedback({ type: 'err', text: res.error || 'Échec de l\'envoi.' });
      }
    });
  };

  const accept = (id: string) => {
    emit('friend_accept', { friendId: id }, (res: any) => {
      if (res?.success) { setFeedback({ type: 'ok', text: 'Ami ajouté !' }); refresh(); }
      else setFeedback({ type: 'err', text: res?.error || 'Échec.' });
    });
  };

  const remove = (id: string, label: string) => {
    emit('friend_remove', { friendId: id }, (res: any) => {
      if (res?.success) { setFeedback({ type: 'ok', text: `${label} retiré.` }); refresh(); }
      else setFeedback({ type: 'err', text: res?.error || 'Échec.' });
    });
  };

  const incoming = friends.filter((f: any) => f.status === 'pending');
  const outgoing = friends.filter((f: any) => f.status === 'pending_sent');
  const accepted = friends.filter((f: any) => f.status === 'accepted');

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-4" style={{ fontFamily: 'serif' }}>👥 Amis</h2>

        {/* Add Friend */}
        <div className="flex gap-2">
          <input
            type="text" value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) sendRequest(); }}
            placeholder="Nom du joueur à ajouter..."
            maxLength={20}
            className="flex-1 bg-[#0d0520] border border-amber-500/30 rounded-lg px-4 py-2 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 text-sm"
          />
          <button onClick={sendRequest} disabled={busy || !addUsername.trim()}
            className="bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-amber-300 px-5 py-2 rounded-lg text-sm font-bold transition-all">
            {busy ? '...' : 'Ajouter'}
          </button>
        </div>

        {/* Feedback inline (remplace les alert()) */}
        {feedback && (
          <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
            feedback.type === 'ok'
              ? 'text-green-300 bg-green-500/10 border-green-500/30'
              : 'text-red-300 bg-red-500/10 border-red-500/30'
          }`}>
            {feedback.text}
          </div>
        )}
      </div>

      {/* Demandes reçues : seules celles-ci ont un bouton Accepter */}
      {incoming.length > 0 && (
        <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
          <h3 className="text-amber-300 font-bold text-lg mb-3" style={{ fontFamily: 'serif' }}>
            📩 Demandes reçues <span className="text-amber-500/60 text-sm">({incoming.length})</span>
          </h3>
          <div className="space-y-2">
            {incoming.map((f: any) => (
              <div key={f.id} className="bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20 flex items-center justify-between">
                <span className="text-amber-300 font-bold text-sm">{f.username}</span>
                <div className="flex gap-2">
                  <button onClick={() => accept(f.id)}
                    className="text-green-300 text-xs font-bold bg-green-500/20 px-3 py-1 rounded hover:bg-green-500/30 transition-all">
                    Accepter
                  </button>
                  <button onClick={() => remove(f.id, f.username)}
                    className="text-red-300 text-xs font-bold bg-red-500/20 px-3 py-1 rounded hover:bg-red-500/30 transition-all">
                    Refuser
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Demandes envoyées : en attente, pas de bouton Accepter */}
      {outgoing.length > 0 && (
        <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
          <h3 className="text-amber-300 font-bold text-lg mb-3" style={{ fontFamily: 'serif' }}>
            📤 Demandes envoyées <span className="text-amber-500/60 text-sm">({outgoing.length})</span>
          </h3>
          <div className="space-y-2">
            {outgoing.map((f: any) => (
              <div key={f.id} className="bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20 flex items-center justify-between">
                <span className="text-amber-200/70 text-sm">{f.username}</span>
                <div className="flex items-center gap-3">
                  <span className="text-amber-500/50 text-xs italic">En attente…</span>
                  <button onClick={() => remove(f.id, f.username)}
                    className="text-red-300 text-xs bg-red-500/20 px-2 py-1 rounded hover:bg-red-500/30 transition-all">
                    Annuler
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste des amis confirmés */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-300 font-bold text-lg mb-3" style={{ fontFamily: 'serif' }}>
          🤝 Mes amis <span className="text-amber-500/60 text-sm">({accepted.length})</span>
        </h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {accepted.length === 0 ? (
            <div className="text-amber-500/50 text-center py-8">Aucun ami pour l'instant. Ajoute des joueurs !</div>
          ) : (
            accepted
              .slice()
              .sort((a: any, b: any) => (b.online ? 1 : 0) - (a.online ? 1 : 0))
              .map((f: any) => (
                <div key={f.id} className="bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20 flex items-center justify-between group">
                  <div className="flex items-center gap-2">
                    <span className={f.online ? 'text-green-400' : 'text-gray-600'} title={f.online ? 'En ligne' : 'Hors ligne'}>●</span>
                    <span className="text-amber-300 font-bold text-sm">{f.username}</span>
                    <span className="text-amber-200/40 text-xs">🏆 {f.renown ?? 0}</span>
                  </div>
                  <button onClick={() => remove(f.id, f.username)}
                    className="text-red-300/60 text-xs bg-red-500/10 px-2 py-1 rounded hover:bg-red-500/30 hover:text-red-300 transition-all opacity-0 group-hover:opacity-100">
                    Retirer
                  </button>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CHAT TAB
// ============================================================
function ChatTab({ emit }: { emit: any }) {
  const { chatMessages, player } = useGameStore();
  const [message, setMessage] = useState('');
  const [duelOpen, setDuelOpen] = useState(false);
  const [duelTarget, setDuelTarget] = useState('');
  const [duelStake, setDuelStake] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    emit('chat_history', { limit: 50 }, (res: any) => {
      if (res.success) {
        useGameStore.getState().setChatMessages(res.messages || []);
      }
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendMessage = () => {
    if (!message.trim()) return;
    emit('chat_message', { message: message.trim() }, () => setMessage(''));
  };

  const sendDuel = () => {
    const name = duelTarget.trim();
    const stake = Math.floor(Number(duelStake));
    if (!name) { useGameStore.getState().addNotification({ type: 'error', message: 'Entre un pseudo' }); return; }
    if (!Number.isFinite(stake) || stake <= 0) { useGameStore.getState().addNotification({ type: 'error', message: 'Mise invalide' }); return; }
    emit('duel_request', { targetName: name, stake }, (res: any) => {
      if (!res?.success) useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Duel impossible' });
      else {
        useGameStore.getState().addNotification({ type: 'success', message: `Défi envoyé à ${name} (mise ${stake}).` });
        setDuelOpen(false); setDuelTarget(''); setDuelStake('');
      }
    });
  };

  return (
    <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6 h-[calc(100vh-200px)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-amber-400" style={{ fontFamily: 'serif' }}>💬 Tchat Global</h2>
        <button onClick={() => setDuelOpen(o => !o)}
          className="px-3 py-1.5 rounded-lg text-sm font-bold bg-gradient-to-r from-red-700 to-amber-800 hover:from-red-600 hover:to-amber-700 text-amber-50 transition-all">
          ⚔️ /duel
        </button>
      </div>

      {duelOpen && (
        <div className="mb-4 bg-[#0d0520]/80 border border-red-400/40 rounded-lg p-3">
          <div className="text-amber-200/70 text-xs mb-2">Défie un joueur en 1 contre 1. Le gagnant remporte les 2 mises de renommée. Aucune autre récompense (ni xp, ni item, ni ressource).</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="text" value={duelTarget} onChange={(e) => setDuelTarget(e.target.value)}
              placeholder="Pseudo du joueur"
              className="flex-1 bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-2 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 text-sm" />
            <input type="number" min={1} value={duelStake} onChange={(e) => setDuelStake(e.target.value)}
              placeholder="Mise (renommée)"
              className="w-full sm:w-40 bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-2 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 text-sm" />
            <button onClick={sendDuel}
              className="bg-gradient-to-r from-red-700 to-amber-800 hover:from-red-600 hover:to-amber-700 text-amber-50 px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap">
              Envoyer le défi
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 mb-4 bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/20">
        {chatMessages.map((msg: any, i: number) => (
          msg.isAdminAlert ? (
            <div key={msg.id || i} className="text-sm rounded-lg px-3 py-2 bg-red-900/30 border border-red-400/50">
              <span className="text-red-300 font-extrabold">[{msg.username}]</span>
              <span className="text-red-200 font-extrabold ml-2">{msg.message}</span>
            </div>
          ) : (
          <div key={msg.id || i} className="text-sm">
            <span className="text-amber-400 font-bold">[{msg.username}]</span>
            <span className="text-amber-200/70 ml-2">{msg.message}</span>
          </div>
          )
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="flex gap-2">
        <input
          type="text" value={message} onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Votre message..."
          className="flex-1 bg-[#0d0520] border border-amber-500/30 rounded-lg px-4 py-2 text-amber-100 placeholder-amber-700/50 focus:outline-none focus:border-amber-400 text-sm"
        />
        <button onClick={sendMessage}
          className="bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-100 px-4 py-2 rounded-lg text-sm font-bold transition-all">
          Envoyer
        </button>
      </div>
    </div>
  );
}

// ============================================================
// LEADERBOARD TAB
// ============================================================
function LeaderboardTab({ emit }: { emit: any }) {
  const { leaderboard } = useGameStore();
  const [towerBoard, setTowerBoard] = useState<any[]>([]);
  const [goldBoard, setGoldBoard] = useState<any[]>([]);
  const [view, setView] = useState<'renown' | 'tower' | 'gold'>('renown');

  useEffect(() => {
    emit('leaderboard', {}, (res: any) => {
      if (res.success) {
        useGameStore.getState().setLeaderboard(res.leaderboard);
        setTowerBoard(res.towerLeaderboard || []);
        setGoldBoard(res.goldLeaderboard || []);
      }
    });
  }, []);

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);

  return (
    <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
      <h2 className="text-2xl font-bold text-amber-400 mb-3" style={{ fontFamily: 'serif' }}>🏆 Classements</h2>

      {/* Onglets */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setView('renown')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${view === 'renown' ? 'bg-amber-600 border-amber-400 text-white' : 'bg-[#0d0520] border-amber-500/30 text-amber-200/60 hover:border-amber-400'}`}>
          🏆 Renommée
        </button>
        <button onClick={() => setView('tower')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${view === 'tower' ? 'bg-purple-600 border-purple-400 text-white' : 'bg-[#0d0520] border-purple-500/30 text-amber-200/60 hover:border-purple-400'}`}>
          🗼 Tour
        </button>
        <button onClick={() => setView('gold')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${view === 'gold' ? 'bg-yellow-600 border-yellow-400 text-black' : 'bg-[#0d0520] border-yellow-500/30 text-amber-200/60 hover:border-yellow-400'}`}>
          🪙 Or
        </button>
      </div>

      {view === 'renown' ? (
        <>
          <p className="text-amber-200/50 text-sm mb-4">Classement par renommée totale</p>
          {leaderboard.length === 0 ? (
            <div className="text-amber-500/50 text-center py-8">Aucun classement disponible</div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((p: any, i: number) => (
                <div key={p.id} className={`bg-[#0d0520]/80 rounded-lg p-3 border flex items-center justify-between ${i < 3 ? 'border-amber-400/40' : 'border-amber-500/20'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl w-8 text-center">{medal(i)}</span>
                    <span className="text-amber-300 font-bold">{p.username}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-amber-400">🏆 {p.renown}</span>
                    {p.prestige_count > 0 && <span className="text-purple-400 text-xs">✨ P{p.prestige_count}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : view === 'tower' ? (
        <>
          <p className="text-amber-200/50 text-sm mb-4">Plus haut étage de la Tour atteint</p>
          {towerBoard.length === 0 ? (
            <div className="text-amber-500/50 text-center py-8">Personne n'a encore gravi la Tour</div>
          ) : (
            <div className="space-y-2">
              {towerBoard.map((p: any, i: number) => (
                <div key={p.id} className={`bg-[#0d0520]/80 rounded-lg p-3 border flex items-center justify-between ${i < 3 ? 'border-purple-400/40' : 'border-amber-500/20'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl w-8 text-center">{medal(i)}</span>
                    <span className="text-amber-300 font-bold">{p.username}</span>
                  </div>
                  <span className="text-purple-300 font-bold">🗼 Étage {p.best_floor}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-amber-200/50 text-sm mb-4">Or total possédé par les joueurs</p>
          {goldBoard.length === 0 ? (
            <div className="text-amber-500/50 text-center py-8">Aucun classement disponible</div>
          ) : (
            <div className="space-y-2">
              {goldBoard.map((p: any, i: number) => (
                <div key={p.id} className={`bg-[#0d0520]/80 rounded-lg p-3 border flex items-center justify-between ${i < 3 ? 'border-yellow-400/40' : 'border-amber-500/20'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl w-8 text-center">{medal(i)}</span>
                    <span className="text-amber-300 font-bold">{p.username}</span>
                  </div>
                  <span className="text-yellow-300 font-bold">🪙 {Math.floor(p.gold).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// PRESTIGE TAB
// ============================================================
function PrestigeTab({ emit }: { emit: any }) {
  const { player, village, prestigeBonus } = useGameStore();

  const requiredThLevel = 5 + (player?.prestige_count ?? 0);
  const canPrestige = (village?.town_hall_level ?? 0) >= requiredThLevel;
  const nextBonuses = player ? (() => {
    const count = player.prestige_count + 1;
    return {
      production: `${Math.round((1 + count * 0.1) * 100 - 100)}%`,
      troop: `${count * 5}%`,
      hero: `${count * 3}%`,
    };
  })() : null;

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-amber-400 mb-4" style={{ fontFamily: 'serif' }}>✨ Prestige</h2>
        <p className="text-amber-200/60 text-sm mb-4">
          Réinitialisez votre village en échange de bonus permanents cumulables. Plus vous prestigez, plus vous devenez puissant !
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#0d0520]/80 rounded-lg p-4 border border-purple-500/30 text-center">
            <div className="text-3xl mb-2">✨</div>
            <div className="text-purple-300 font-bold text-lg">{player?.prestige_count || 0}</div>
            <div className="text-amber-200/40 text-xs">Prestiges actuels</div>
          </div>
          <div className="bg-[#0d0520]/80 rounded-lg p-4 border border-amber-500/30 text-center">
            <div className="text-3xl mb-2">⚡</div>
            <div className="text-amber-300 font-bold text-lg">{prestigeBonus ? `${Math.round(prestigeBonus.productionMultiplier * 100 - 100)}%` : '0%'}</div>
            <div className="text-amber-200/40 text-xs">Bonus production</div>
          </div>
          <div className="bg-[#0d0520]/80 rounded-lg p-4 border border-red-500/30 text-center">
            <div className="text-3xl mb-2">⚔️</div>
            <div className="text-red-300 font-bold text-lg">{prestigeBonus ? `${Math.round(prestigeBonus.troopBonus * 100)}%` : '0%'}</div>
            <div className="text-amber-200/40 text-xs">Bonus troupes</div>
          </div>
        </div>

        {/* Next prestige preview */}
        {nextBonuses && (
          <div className="bg-[#0d0520]/80 rounded-lg p-4 border border-amber-400/30 mb-6">
            <h3 className="text-amber-400 font-bold mb-2">Prochain prestige (#{(player?.prestige_count || 0) + 1}):</h3>
            <div className="text-amber-200/60 text-sm space-y-1">
              <p>⚡ Production: +{nextBonuses.production}</p>
              <p>⚔️ Troupes: +{nextBonuses.troop}</p>
              <p>🦸 Héros: +{nextBonuses.hero}</p>
            </div>
          </div>
        )}

        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-red-300 text-sm">⚠️ Le prestige réinitialise votre village, vos troupes et votre progression de campagne. Vous conservez vos bonus de prestige et vos équipements.</p>
        </div>

        <button
          onClick={() => {
            if (confirm('Êtes-vous sûr ? Votre village sera réinitialisé !')) {
              emit('prestige', {}, (res: any) => {
                if (!res.success) useGameStore.getState().addNotification({ type: 'error', message: res.error });
              });
            }
          }}
          disabled={!canPrestige}
          className="bg-gradient-to-r from-purple-700 to-amber-700 hover:from-purple-600 hover:to-amber-600 text-amber-100 px-8 py-3 rounded-lg font-bold transition-all shadow-lg shadow-purple-900/30 disabled:opacity-50"
        >
          {canPrestige ? '✨ Prestige !' : `🔒 HdV Niv. ${requiredThLevel} requis (actuel: ${village?.town_hall_level || 1})`}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// EVENTS TAB
// ============================================================
// ============================================================
// ADMIN TAB — gestion des joueurs + sauvegardes
// ============================================================
function AdminTab({ emit }: { emit: any }) {
  const [players, setPlayers] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, { renown: string; prestige: string; thl: string }>>({});
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [pwInputs, setPwInputs] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<any>(null);
  const [diffDraft, setDiffDraft] = useState<any>(null);
  const [alertMsg, setAlertMsg] = useState('');
  const [heroCampEnabled, setHeroCampEnabled] = useState<boolean | null>(null);
  const [disabledTabs, setDisabledTabs] = useState<string[]>([]);
  useEffect(() => { emit('admin_get_config', {}, (r: any) => { if (r?.success) { setHeroCampEnabled(r.heroCampaignEnabled); setDisabledTabs(r.disabledTabs || []); } }); }, []);
  const toggleTab = (id: string) => {
    const next = disabledTabs.includes(id) ? disabledTabs.filter(t => t !== id) : [...disabledTabs, id];
    emit('admin_set_tabs', { disabledTabs: next }, (r: any) => {
      if (r?.success) { setDisabledTabs(r.disabledTabs); useGameStore.getState().addNotification({ type: 'success', message: 'Onglets mis à jour.' }); }
      else useGameStore.getState().addNotification({ type: 'error', message: r?.error || 'Erreur' });
    });
  };
  const toggleHeroCamp = (val: boolean) => {
    emit('admin_set_hero_campaign', { enabled: val }, (r: any) => {
      if (r?.success) { setHeroCampEnabled(r.heroCampaignEnabled); useGameStore.getState().addNotification({ type: 'success', message: `Mode héros ${r.heroCampaignEnabled ? 'activé' : 'désactivé'}.` }); }
      else useGameStore.getState().addNotification({ type: 'error', message: r?.error || 'Erreur' });
    });
  };

  const sendAlert = () => {
    const m = alertMsg.trim();
    if (!m) return;
    setBusy(true);
    emit('admin_send_alert', { message: m }, (res: any) => {
      setBusy(false);
      if (res?.success) { setAlertMsg(''); useGameStore.getState().addNotification({ type: 'success', message: 'Alerte envoyée.' }); }
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };

  const loadPlayers = () => emit('admin_list_players', {}, (res: any) => { if (res?.success) setPlayers(res.players); else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); });
  const loadBackups = () => emit('admin_list_backups', {}, (res: any) => { if (res?.success) setBackups(res.backups); });
  const loadDiff = () => emit('admin_get_difficulty', {}, (res: any) => { if (res?.success) { setDiff(res.difficulty); setDiffDraft(JSON.parse(JSON.stringify(res.difficulty))); } });

  useEffect(() => { loadPlayers(); loadBackups(); loadDiff(); /* eslint-disable-next-line */ }, []);

  const fieldFor = (p: any) => edits[p.id] || { renown: String(p.renown ?? 0), prestige: String(p.prestige_count ?? 0), thl: String(p.town_hall_level ?? 1), towerBest: String(p.tower_best_floor ?? 0) };
  const setField = (id: string, k: 'renown' | 'prestige' | 'thl' | 'towerBest', v: string) =>
    setEdits(prev => ({ ...prev, [id]: { ...fieldFor(players.find(p => p.id === id)), ...prev[id], [k]: v } }));

  const save = (p: any) => {
    const f = fieldFor(p);
    setBusy(true);
    emit('admin_update_player', {
      playerId: p.id,
      renown: Number(f.renown),
      prestige_count: Number(f.prestige),
      town_hall_level: Number(f.thl),
      tower_best_floor: Number(f.towerBest),
    }, (res: any) => {
      setBusy(false);
      if (res?.success) {
        useGameStore.getState().addNotification({ type: 'success', message: `${p.username} mis à jour.` });
        setEdits(prev => { const n = { ...prev }; delete n[p.id]; return n; });
        loadPlayers();
      } else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };

  const doBackup = () => { setBusy(true); emit('admin_create_backup', {}, (res: any) => { setBusy(false); if (res?.success) { setBackups(res.backups); useGameStore.getState().addNotification({ type: 'success', message: 'Sauvegarde créée.' }); } else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' }); }); };

  const createUser = () => {
    setBusy(true);
    emit('admin_create_user', { username: newUser.trim(), password: newPass }, (res: any) => {
      setBusy(false);
      if (res?.success) { setNewUser(''); setNewPass(''); loadPlayers(); useGameStore.getState().addNotification({ type: 'success', message: 'Compte créé.' }); }
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };
  const setPassword = (p: any) => {
    const pw = pwInputs[p.id] || '';
    setBusy(true);
    emit('admin_set_password', { playerId: p.id, password: pw }, (res: any) => {
      setBusy(false);
      if (res?.success) { setPwInputs(prev => { const n = { ...prev }; delete n[p.id]; return n; }); useGameStore.getState().addNotification({ type: 'success', message: `Mot de passe de ${p.username} modifié.` }); }
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };
  const setDiffField = (section: string, key: string, value: string) => {
    setDiffDraft((prev: any) => ({ ...prev, [section]: { ...prev[section], [key]: value === '' ? '' : Number(value) } }));
  };
  const setDiffMults = (value: string) => {
    const arr = value.split(',').map(s => Number(s.trim())).filter(n => isFinite(n) && n > 0);
    setDiffDraft((prev: any) => ({ ...prev, tower: { ...prev.tower, allowedMultipliers: arr } }));
  };
  const saveDiff = () => {
    setBusy(true);
    emit('admin_set_difficulty', { difficulty: diffDraft }, (res: any) => {
      setBusy(false);
      if (res?.success) { setDiff(res.difficulty); setDiffDraft(JSON.parse(JSON.stringify(res.difficulty))); useGameStore.getState().addNotification({ type: 'success', message: 'Difficulté enregistrée.' }); }
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };
  const resetDiff = () => {
    if (!confirm('Réinitialiser toute la difficulté aux valeurs par défaut ?')) return;
    setBusy(true);
    emit('admin_reset_difficulty', {}, (res: any) => {
      setBusy(false);
      if (res?.success) { setDiff(res.difficulty); setDiffDraft(JSON.parse(JSON.stringify(res.difficulty))); useGameStore.getState().addNotification({ type: 'success', message: 'Difficulté réinitialisée.' }); }
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };

  const doRestore = (name: string) => {
    if (!confirm(`Restaurer la sauvegarde ${name} ? L'état actuel sera d'abord sauvegardé, puis remplacé.`)) return;
    setBusy(true);
    emit('admin_restore_backup', { name }, (res: any) => {
      setBusy(false);
      if (res?.success) { setBackups(res.backups); loadPlayers(); useGameStore.getState().addNotification({ type: 'success', message: 'Sauvegarde restaurée.' }); }
      else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
    });
  };

  const filtered = players.filter(p => p.username.toLowerCase().includes(search.toLowerCase()));
  const fmtDate = (ms: number) => new Date(ms).toLocaleString('fr-FR');
  const fmtSize = (b: number) => b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.round(b / 1e3)} Ko`;

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-red-500/30 rounded-xl p-6">
        <h2 className="text-2xl font-bold text-red-300 mb-1" style={{ fontFamily: 'serif' }}>🛡️ Administration</h2>
        <p className="text-red-200/50 text-sm">Gestion des joueurs et des sauvegardes. Sauvegarde automatique toutes les 12 h, 10 versions conservées.</p>
      </div>

      {/* Activation des onglets */}
      <div className="bg-[#1a0a2e]/60 border border-cyan-500/30 rounded-xl p-6">
        <h3 className="text-cyan-300 font-bold mb-1">🧭 Onglets disponibles</h3>
        <p className="text-amber-200/40 text-xs mb-3">Active ou désactive chaque onglet pour tous les joueurs. Les onglets désactivés disparaissent de leur navigation (l'Admin reste toujours actif).</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {[
            { id: 'village', label: '🏘️ Village' }, { id: 'troops', label: '⚔️ Troupes' }, { id: 'hero', label: '🦸 Héros' },
            { id: 'campaign', label: '📜 Campagne' }, { id: 'dungeon', label: '🗝️ Donjons' }, { id: 'bosses', label: '👹 Boss' },
            { id: 'tower', label: '🗼 Tour' }, { id: 'market', label: '🏪 Marché' }, { id: 'research', label: '🔬 Recherche' },
            { id: 'craft', label: '⚒️ Craft' }, { id: 'friends', label: '👥 Amis' }, { id: 'chat', label: '💬 Tchat' },
            { id: 'leaderboard', label: '🏆 Classement' }, { id: 'prestige', label: '✨ Prestige' }, { id: 'events', label: '🎉 Événements' },
          ].map(t => {
            const on = !disabledTabs.includes(t.id);
            return (
              <button key={t.id} onClick={() => toggleTab(t.id)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-bold border transition-all ${on ? 'bg-green-600/15 border-green-400/40 text-green-200' : 'bg-red-600/15 border-red-400/30 text-red-300/70'}`}>
                <span>{t.label}</span>
                <span className="text-xs">{on ? '🟢' : '🔴'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode campagne héros */}
      <div className="bg-[#1a0a2e]/60 border border-purple-500/30 rounded-xl p-6">
        <h3 className="text-purple-300 font-bold mb-1">🦸 Mode « Campagne héros seul »</h3>
        <p className="text-amber-200/40 text-xs mb-3">Active/désactive pour tous les joueurs le mode de campagne en duels héros contre ennemi (sans armée). Le mode « avec l'armée » reste le mode par défaut.</p>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${heroCampEnabled ? 'text-green-300' : 'text-red-300'}`}>{heroCampEnabled === null ? 'Chargement…' : heroCampEnabled ? '🟢 Activé' : '🔴 Désactivé'}</span>
          <button disabled={heroCampEnabled === null} onClick={() => toggleHeroCamp(!heroCampEnabled)}
            className={`px-4 py-2 rounded-lg text-sm font-bold ${heroCampEnabled ? 'bg-red-600/40 text-red-100 hover:bg-red-600/60' : 'bg-green-600/40 text-green-100 hover:bg-green-600/60'}`}>
            {heroCampEnabled ? 'Désactiver' : 'Activer'}
          </button>
        </div>
      </div>

      {/* Alerte */}
      <div className="bg-[#1a0a2e]/60 border border-red-500/30 rounded-xl p-6">
        <h3 className="text-red-300 font-bold mb-1">📢 Envoyer une alerte</h3>
        <p className="text-amber-200/40 text-xs mb-3">Affichée au centre de l'écran de tous les joueurs (8 s) et en gras coloré dans le tchat.</p>
        <div className="flex gap-2 flex-wrap">
          <input value={alertMsg} onChange={e => setAlertMsg(e.target.value)} placeholder="Message de l'alerte…"
            onKeyDown={e => { if (e.key === 'Enter') sendAlert(); }}
            className="flex-1 min-w-[200px] bg-[#0d0520] border border-red-500/30 rounded-lg px-3 py-2 text-sm text-amber-100" />
          <button disabled={busy || !alertMsg.trim()} onClick={sendAlert}
            className={`px-4 py-2 rounded-lg text-sm font-bold ${busy || !alertMsg.trim() ? 'bg-black/20 text-red-400/30 cursor-not-allowed' : 'bg-red-600/40 text-red-100 hover:bg-red-600/60'}`}>
            Envoyer
          </button>
        </div>
      </div>

      {/* Joueurs */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="text-amber-400 font-bold">👥 Joueurs ({players.length})</h3>
          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
              className="bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-1.5 text-sm text-amber-200" />
            <button onClick={loadPlayers} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">↻ Rafraîchir</button>
          </div>
        </div>
        <div className="flex items-end gap-2 mb-4 flex-wrap bg-[#0d0520]/60 rounded-lg p-3 border border-amber-500/15">
          <div>
            <div className="text-amber-300/60 text-xs mb-1">Nouveau joueur</div>
            <input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="Nom"
              className="bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-1.5 text-sm text-amber-200" />
          </div>
          <div>
            <div className="text-amber-300/60 text-xs mb-1">Mot de passe</div>
            <input value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Mot de passe"
              className="bg-[#0d0520] border border-amber-500/30 rounded-lg px-3 py-1.5 text-sm text-amber-200" />
          </div>
          <button disabled={busy || newUser.trim().length < 2 || newPass.length < 3} onClick={createUser}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${busy || newUser.trim().length < 2 || newPass.length < 3 ? 'bg-black/20 text-amber-500/30 cursor-not-allowed' : 'bg-green-600/30 text-green-200 hover:bg-green-600/50'}`}>
            + Ajouter le joueur
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-amber-300/60 text-xs text-left border-b border-amber-500/20">
                <th className="py-2 pr-3">Joueur</th>
                <th className="py-2 pr-3">Renommée</th>
                <th className="py-2 pr-3">Prestige</th>
                <th className="py-2 pr-3">Niv. HDV</th>
                <th className="py-2 pr-3">Étage max tour</th>
                <th className="py-2 pr-3">Mot de passe</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const f = fieldFor(p);
                const dirty = !!edits[p.id];
                return (
                  <tr key={p.id} className="border-b border-amber-500/10">
                    <td className="py-2 pr-3">
                      <span className={`font-bold ${p.is_admin ? 'text-red-300' : 'text-amber-200'}`}>{p.username}</span>
                      {p.online ? <span className="ml-1 text-green-400 text-[10px]">●</span> : null}
                    </td>
                    <td className="py-2 pr-3"><input value={f.renown} onChange={e => setField(p.id, 'renown', e.target.value)} className="w-24 bg-[#0d0520] border border-amber-500/20 rounded px-2 py-1 text-amber-200" /></td>
                    <td className="py-2 pr-3"><input value={f.prestige} onChange={e => setField(p.id, 'prestige', e.target.value)} className="w-16 bg-[#0d0520] border border-amber-500/20 rounded px-2 py-1 text-amber-200" /></td>
                    <td className="py-2 pr-3"><input value={f.thl} onChange={e => setField(p.id, 'thl', e.target.value)} className="w-16 bg-[#0d0520] border border-amber-500/20 rounded px-2 py-1 text-amber-200" /></td>
                    <td className="py-2 pr-3"><input value={f.towerBest} onChange={e => setField(p.id, 'towerBest', e.target.value)} className="w-20 bg-[#0d0520] border border-purple-500/30 rounded px-2 py-1 text-purple-200" /></td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <input value={pwInputs[p.id] || ''} onChange={e => setPwInputs(prev => ({ ...prev, [p.id]: e.target.value }))} placeholder="Nouveau"
                          className="w-28 bg-[#0d0520] border border-amber-500/20 rounded px-2 py-1 text-amber-200" />
                        <button disabled={busy || (pwInputs[p.id] || '').length < 3} onClick={() => setPassword(p)}
                          className={`px-2 py-1 rounded text-xs font-bold ${busy || (pwInputs[p.id] || '').length < 3 ? 'bg-black/20 text-amber-500/30 cursor-not-allowed' : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/40'}`}>
                          OK
                        </button>
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <button disabled={!dirty || busy} onClick={() => save(p)}
                        className={`px-3 py-1 rounded text-xs font-bold ${dirty && !busy ? 'bg-green-600/30 text-green-200 hover:bg-green-600/50' : 'bg-black/20 text-amber-500/30 cursor-not-allowed'}`}>
                        Enregistrer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Difficulté */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <h3 className="text-amber-400 font-bold">⚙️ Difficulté & multiplicateurs</h3>
          <div className="flex gap-2">
            <button disabled={busy} onClick={resetDiff} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/20 text-red-300 hover:bg-red-500/40">Valeurs par défaut</button>
            <button disabled={busy || !diffDraft} onClick={saveDiff} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600/30 text-green-200 hover:bg-green-600/50">Enregistrer</button>
          </div>
        </div>
        <p className="text-amber-200/40 text-xs mb-4">Contrôle total de la campagne, de la tour et des boss. Les changements s'appliquent immédiatement aux nouveaux combats.</p>
        {!diffDraft ? <div className="text-amber-500/50 py-4 text-center">Chargement…</div> : (
          <div className="space-y-5">
            {([
              ['tower', '🗼 Tour', {
                multScalePerMult: 'Pente difficulté / multiplicateur',
                statBoostPerMult: 'Bonus stats ennemi / multiplicateur',
                troopBase: 'Ennemis (base)',
                troopPerDiff: 'Ennemis / difficulté',
                heroLevelPerFloor: 'Niv. héros ennemi / étage',
                rewardBase: 'Récompense (base)',
                rewardPerDiff: 'Récompense / difficulté',
                resetMinFloor: 'Étage minimum après reset',
              }],
              ['campaign', '📜 Campagne', {
                curveBase: 'Base de la courbe (ex 1.10)',
                bossMultiplier: 'Dureté boss de chapitre',
                troopBase: 'Ennemis (base)',
                troopPerDiff: 'Ennemis / difficulté',
                heroLevelPerDiff: 'Niv. héros ennemi / difficulté',
                rewardBase: 'Récompense (base)',
                rewardPerDiff: 'Récompense / difficulté',
              }],
              ['boss', '👹 Boss', {
                curveExp: 'Exposant courbe (ex 1.35)',
                curveMul: 'Facteur courbe (ex 1.8)',
                partyScalePerPlayer: 'Dureté / joueur en coop',
                troopBase: 'Ennemis (base)',
                troopPerDiff: 'Ennemis / difficulté',
                heroLevelPerIndex: 'Niv. héros / index boss',
                bossMulBase: 'Multiplicateur stats (base)',
                bossMulPerIndex: 'Multiplicateur stats / index',
                rewardBase: 'Récompense (base)',
                rewardPerDiff: 'Récompense / difficulté',
              }],
            ] as [string, string, Record<string, string>][]).map(([section, title, fields]) => (
              <div key={section} className="bg-[#0d0520]/60 rounded-lg p-4 border border-amber-500/15">
                <div className="text-amber-300 font-bold text-sm mb-3">{title}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(fields).map(([key, label]) => (
                    <div key={key}>
                      <div className="text-amber-200/50 text-xs mb-1">{label}</div>
                      <input
                        type="number" step="any"
                        value={diffDraft[section]?.[key] ?? ''}
                        onChange={e => setDiffField(section, key, e.target.value)}
                        className="w-full bg-[#0d0520] border border-amber-500/20 rounded px-2 py-1 text-amber-200 text-sm" />
                    </div>
                  ))}
                </div>
                {section === 'tower' && (
                  <div className="mt-3">
                    <div className="text-amber-200/50 text-xs mb-1">Multiplicateurs proposés (séparés par des virgules)</div>
                    <input
                      value={(diffDraft.tower?.allowedMultipliers || []).join(', ')}
                      onChange={e => setDiffMults(e.target.value)}
                      className="w-full bg-[#0d0520] border border-amber-500/20 rounded px-2 py-1 text-amber-200 text-sm" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sauvegardes */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="text-amber-400 font-bold">💾 Sauvegardes ({backups.length}/10)</h3>
          <button disabled={busy} onClick={doBackup} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">+ Créer une sauvegarde</button>
        </div>
        {backups.length === 0 ? (
          <div className="text-amber-500/50 text-center py-4">Aucune sauvegarde pour le moment.</div>
        ) : (
          <div className="space-y-2">
            {backups.map(b => (
              <div key={b.name} className="flex items-center justify-between gap-2 bg-[#0d0520]/80 rounded-lg p-3 border border-amber-500/15">
                <div className="min-w-0">
                  <div className="text-amber-200 text-sm font-medium truncate">{b.name}</div>
                  <div className="text-amber-200/40 text-xs">{fmtDate(b.createdAt)} · {fmtSize(b.size)}</div>
                </div>
                <button disabled={busy} onClick={() => doRestore(b.name)}
                  className="px-3 py-1 rounded text-xs font-bold bg-red-500/20 text-red-300 hover:bg-red-500/40 shrink-0">
                  Restaurer
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DungeonTab({ emit }: { emit: any }) {
  const { troops } = useGameStore();
  const [info, setInfo] = useState<any>(null);
  const [quest, setQuest] = useState<any>(null);
  const [selectedTroops, setSelectedTroops] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    emit('dungeon_info', {}, (r: any) => { if (r?.success) setInfo(r); });
    emit('key_quest_info', {}, (r: any) => { if (r?.success) setQuest(r); });
  };
  useEffect(() => { refresh(); }, []);
  const sig = troopsSignature(troops);
  useEffect(() => { setSelectedTroops(maxSelection(troops)); }, [sig]);

  const notify = (res: any, ok?: string) => {
    if (res?.success) { if (ok) useGameStore.getState().addNotification({ type: 'success', message: ok }); }
    else useGameStore.getState().addNotification({ type: 'error', message: res?.error || 'Erreur' });
  };

  // Lance la manche courante : prépare le combat puis enchaîne sur victoire.
  const launchRound = () => {
    const safe = clampSelection(selectedTroops, troops);
    const allyTypes = Object.keys(safe).filter(k => (safe[k] || 0) > 0);
    const originalTroops = allyTypes.map(type => { const t = troops.find((x: any) => x.type === type); return { type, count: safe[type], level: t?.level || 1 }; });
    emit('dungeon_setup', { troops: safe }, (res: any) => {
      if (!res?.success) { notify(res); return; }
      const su = res.setup;
      const state = initCombat({ hero: su.heroStats, heroSkillLevels: su.skillLevels, troops: originalTroops, enemyTroops: su.enemyTroops, enemyHero: su.enemyHero, enemyLabel: su.label });
      useGameStore.setState({ pendingBattle: {
        state, scene: su.isBoss ? 'tower' : 'forest', allyTypes, originalTroops,
        applyEvent: 'dungeon_battle', applyData: { troops: safe },
        bossIndex: su.bossIndex || null, isBoss: su.isBoss,
        onApplied: (r: any) => {
          if (r.completed) useGameStore.getState().addNotification({ type: 'success', message: `🏆 Donjon terminé ! +${(r.result?.renownGained || 100000).toLocaleString()} renommée !` });
          else if (r.failed) useGameStore.getState().addNotification({ type: 'error', message: `💀 Donjon échoué à la manche ${r.round}. La clé est perdue.` });
          setTimeout(refresh, 100);
        },
      }});
    });
  };

  const run = info?.run;
  const keys = info?.keys ?? 0;
  // Portail ouvert si une descente est en cours ou si le joueur a une clé.
  const portalOpen = !!run || keys > 0;

  return (
    <div className="space-y-6">
      <div className="bg-[#1a0a2e]/60 border border-purple-500/40 rounded-xl p-6">
        <div className="flex flex-col items-center text-center">
          <img src={portalOpen ? '/portal_open.png' : '/portal_closed.png'} alt={portalOpen ? 'Portail ouvert' : 'Portail fermé'}
            className="h-56 w-auto object-contain mb-3" style={{ filter: portalOpen ? 'drop-shadow(0 0 20px rgba(168,85,247,.6))' : 'grayscale(0.3) brightness(0.9)' }} />
          <div className="flex items-center gap-3 mb-1">
            <img src="/dungeon_key.png" alt="" className="h-10 w-10 object-contain" />
            <h2 className="text-2xl font-bold text-purple-300" style={{ fontFamily: 'serif' }}>🗝️ Donjons</h2>
          </div>
          <p className="text-purple-200/60 text-sm font-bold mb-1">{portalOpen ? '🟣 Portail ouvert' : '🔒 Portail scellé — il te faut une clé'}</p>
          <p className="text-purple-200/50 text-sm max-w-xl">5 manches enchaînées : 4 vagues de monstres (niveau moyen+) puis un boss très puissant. Réussis tout le donjon pour gagner <span className="text-amber-300 font-bold">100 000 renommée</span>. Conseillé à plusieurs. Il faut <span className="text-purple-200 font-bold">1 clé</span> par descente.</p>
          <div className="mt-2 text-purple-200/70 text-sm">🗝️ Clés en ta possession : <span className="text-purple-100 font-bold">{keys}</span></div>
        </div>
      </div>

      {/* Descente en cours OU démarrage */}
      <div className="bg-[#1a0a2e]/60 border border-purple-500/30 rounded-xl p-6">
        {run ? (
          <>
            <h3 className="text-purple-300 font-bold mb-2">⚔️ Descente en cours — Manche {run.round}/{info.rounds}</h3>
            <div className="flex gap-1.5 mb-3">
              {Array.from({ length: info.rounds }, (_, i) => i + 1).map(r => (
                <div key={r} className={`flex-1 h-2 rounded ${r < run.round ? 'bg-green-500' : r === run.round ? 'bg-purple-400' : 'bg-black/40'}`} />
              ))}
            </div>
            <p className="text-purple-200/50 text-xs mb-3">{run.round >= info.rounds ? '🔥 Manche finale : le BOSS du donjon.' : 'Vague de monstres. Survis aux 4 vagues pour atteindre le boss.'}</p>
            <div className="bg-[#0d0520]/80 rounded-lg p-4 border border-purple-500/20 mb-3">
              <h4 className="text-purple-300 font-bold text-sm mb-2">Sélection des troupes</h4>
              <BattleTroopPicker troops={troops} selected={selectedTroops} onChange={setSelectedTroops} />
            </div>
            <button onClick={launchRound} disabled={busy || Object.values(selectedTroops).every(v => v === 0)}
              className="bg-gradient-to-r from-purple-700 to-red-800 hover:from-purple-600 hover:to-red-700 text-amber-50 px-8 py-3 rounded-lg font-bold disabled:opacity-50">
              ⚔️ Combattre la manche {run.round}
            </button>
          </>
        ) : (
          <>
            <h3 className="text-purple-300 font-bold mb-2">🚪 Entrer dans le donjon</h3>
            <p className="text-purple-200/50 text-sm mb-3">Consomme 1 clé et démarre les 5 manches. En cas de défaite, la clé est perdue.</p>
            <button disabled={busy || keys <= 0} onClick={() => { setBusy(true); emit('dungeon_start', {}, (res: any) => { setBusy(false); notify(res, 'Donjon ouvert !'); refresh(); }); }}
              className="bg-gradient-to-r from-purple-700 to-red-800 hover:from-purple-600 hover:to-red-700 text-amber-50 px-8 py-3 rounded-lg font-bold disabled:opacity-50">
              {keys > 0 ? '🗝️ Ouvrir le donjon (1 clé)' : '🔒 Aucune clé'}
            </button>
          </>
        )}
      </div>

      {/* PNJ du Marché — quête de clé */}
      <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-300 font-bold mb-1">🧙 Gardien des clés (PNJ du Marché)</h3>
        {!quest ? <div className="text-amber-500/50 py-3">Chargement…</div> : (
          <>
            <p className="text-amber-200/50 text-sm mb-3">Bats les boss demandés et rends-moi leurs objets : je te forge une clé. <span className="text-amber-300">Une seule clé par jour.</span> La liste change chaque jour.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
              {quest.items.map((it: any) => {
                const ok = it.have >= it.qty;
                return (
                  <div key={it.icon} className={`rounded-lg p-2 border text-center ${ok ? 'border-green-400/40 bg-green-500/10' : 'border-amber-500/20 bg-black/20'}`}>
                    <img src={it.icon} alt="" className="h-10 w-10 mx-auto object-contain" />
                    <div className="text-amber-200/70 text-[11px] truncate mt-1">{it.name}</div>
                    <div className={`text-xs font-bold ${ok ? 'text-green-400' : 'text-amber-200/60'}`}>{it.have}/{it.qty}</div>
                  </div>
                );
              })}
            </div>
            <button disabled={busy || !quest.complete || quest.claimedToday}
              onClick={() => { setBusy(true); emit('key_claim', {}, (res: any) => { setBusy(false); notify(res, '🗝️ Clé obtenue !'); refresh(); }); }}
              className={`px-6 py-2.5 rounded-lg font-bold transition-all ${(!quest.complete || quest.claimedToday) ? 'bg-[#0d0520] border border-amber-500/15 text-amber-500/30 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-yellow-700 hover:from-amber-400 text-black'}`}>
              {quest.claimedToday ? '✅ Clé déjà récupérée aujourd\'hui' : quest.complete ? '🗝️ Échanger contre la clé' : 'Objets manquants'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EventsTab({ emit }: { emit: any }) {
  const { seasonalEvents } = useGameStore();
  const [daily, setDaily] = useState<any>(null);

  useEffect(() => {
    emit('seasonal_events', {}, (res: any) => {
      if (res.success) useGameStore.getState().setSeasonalEvents(res.events);
    });
    emit('daily_boss', {}, (res: any) => {
      if (res.success) setDaily(res);
    });
  }, []);

  return (
    <div className="bg-[#1a0a2e]/60 border border-amber-500/30 rounded-xl p-6">
      <h2 className="text-2xl font-bold text-amber-400 mb-4" style={{ fontFamily: 'serif' }}>🎉 Événements Saisonniers</h2>

      {/* Boss du jour */}
      {daily && (
        <div className="mb-6 rounded-xl p-5 border-2 border-red-400/50 bg-gradient-to-br from-[#2a0a0a] to-[#1a0a2e] relative overflow-hidden">
          <div className="flex items-center gap-4">
            <img src={`/bosses/boss_${daily.bossIndex}.png`} alt="" className="h-24 w-auto object-contain shrink-0" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.6))' }} />
            <div className="flex-1">
              <div className="text-red-300/80 text-xs font-bold uppercase tracking-wide">⭐ Boss du jour</div>
              <h3 className="text-2xl font-bold text-amber-300" style={{ fontFamily: 'serif' }}>#{daily.bossIndex} — {daily.bossName}</h3>
              <p className="text-amber-200/60 text-sm mt-1">Aujourd'hui ce boss a un taux de drop de son objet signature <span className="text-green-300 font-bold">×2</span>.</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-green-500/20 border border-green-400/40 text-green-200">🎁 Taux de drop ×2</span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/20 border border-amber-400/40 text-amber-200">🏆 Renommée ×{daily.renownMult}</span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-500/20 border border-blue-400/40 text-blue-200">📦 Ressources ×{daily.resourceMult}</span>
              </div>
              <div className="text-amber-200/35 text-xs mt-2">Va dans l'onglet 👹 Boss pour l'affronter. Change chaque jour.</div>
            </div>
          </div>
        </div>
      )}

      <p className="text-amber-200/50 text-sm mb-4">Nouveaux événements toutes les deux semaines avec des récompenses exclusives !</p>

      {seasonalEvents.length === 0 ? (
        <div className="text-amber-500/50 text-center py-8">Aucun événement actif</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {seasonalEvents.map((event: any) => {
            const isActive = event.start_date <= Math.floor(Date.now() / 1000);
            return (
              <div key={event.id} className={`bg-[#0d0520]/80 rounded-xl p-4 border ${isActive ? 'border-amber-400/40' : 'border-amber-500/20'}`}>
                <div className="text-3xl mb-2">{isActive ? '🎉' : '⏳'}</div>
                <h3 className="text-amber-300 font-bold">{event.name}</h3>
                <p className="text-amber-200/50 text-sm mt-1">{event.description}</p>
                <div className="text-amber-400 text-xs mt-2">
                  {isActive ? '🔴 En cours' : `Début: ${new Date(event.start_date * 1000).toLocaleDateString()}`}
                </div>
                <div className="text-amber-200/30 text-xs">
                  Fin: {new Date(event.end_date * 1000).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// COMBAT RESULT MODAL
// ============================================================
function CombatResultModal({ result, onClose }: { result: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#1a0a2e] border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-4">
          <div className="text-5xl mb-2">{result.victory ? '🏆' : '💀'}</div>
          <h2 className={`text-2xl font-bold ${result.victory ? 'text-amber-400' : 'text-red-400'}`} style={{ fontFamily: 'serif' }}>
            {result.victory ? 'Victoire !' : 'Défaite...'}
          </h2>
        </div>

        {result.bossName && (
          <div className="text-center text-amber-300/80 text-sm mb-2">👹 {result.bossName}</div>
        )}
        {result.floor && (
          <div className="text-center text-amber-300 mb-3">Étage {result.floor} atteint</div>
        )}

        <div className="space-y-2 mb-4">
          <div className="text-amber-200/60 text-sm">
            🏆 Renommée: +{result.renownGained}
          </div>
          {result.xpGained > 0 && (
            <div className="text-amber-200/60 text-sm">
              📊 XP héros: +{result.xpGained}
            </div>
          )}
          {result.resourcesGained && Object.entries(result.resourcesGained).some(([, v]) => (v as number) > 0) && (
            <div className="text-amber-200/60 text-sm">
              Ressources: {Object.entries(result.resourcesGained).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${RESOURCE_ICONS[k]}${v}`).join(' ')}
            </div>
          )}
          {result.specialDrop && (
            <div className={`text-sm font-bold ${RARITY_COLORS[result.specialDrop.rarity]}`}>
              🎁 Drop: {result.specialDrop.name} ({result.specialDrop.rarity})
            </div>
          )}
          {result.campaignBossItem && (
            <div className="flex items-center gap-2 text-sm font-bold bg-red-500/10 border border-red-400/30 rounded-lg p-2">
              {result.campaignBossItem.icon ? <img src={result.campaignBossItem.icon} alt="" className="h-8 w-8 object-contain" /> : <span>🏆</span>}
              <span className={RARITY_COLORS[result.campaignBossItem.rarity] || 'text-amber-300'}>
                🏆 Objet de boss : {result.campaignBossItem.name}
              </span>
            </div>
          )}
          {result.stolen && Object.values(result.stolen).some((v: any) => v > 0) && (
            <div className="text-sm text-red-300">
              Volé: {Object.entries(result.stolen).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${RESOURCE_ICONS[k]}${v}`).join(' ')}
            </div>
          )}
        </div>

        <button onClick={onClose}
          className="w-full bg-gradient-to-r from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-amber-100 py-2 rounded-lg font-bold transition-all">
          Continuer
        </button>
      </div>
    </div>
  );
}

// ============================================================
// NOTIFICATION PANEL
// ============================================================
function NotificationPanel() {
  const { notifications } = useGameStore();
  const [open, setOpen] = useState(true);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-72 max-w-[80vw]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-amber-300/80 hover:text-amber-200 text-xs font-bold mb-1 bg-[#0d0520]/80 border border-amber-500/20 rounded px-2 py-1 backdrop-blur-sm">
        🗒️ Historique {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {notifications.slice(-8).reverse().map((n: any) => {
            const err = n.type === 'error';
            return (
              <div key={n.id}
                className={`rounded-lg px-3 py-2 text-xs backdrop-blur-sm shadow-lg border ${
                  err
                    ? 'bg-red-950/80 border-red-500/50 text-red-200'
                    : 'bg-[#1a0a2e]/90 border-amber-500/30 text-amber-200'
                }`}>
                <span className={err ? 'text-red-400/70' : 'text-amber-400/70'}>{n.time}</span>{' '}
                {err && '⚠️ '}{n.message}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LOADING SPINNER
// ============================================================
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-400 rounded-full animate-spin" />
    </div>
  );
}
