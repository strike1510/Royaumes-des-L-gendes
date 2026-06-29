import { Database } from 'bun:sqlite';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, 'game.db');

let db: Database;

export function initDB(): Database {
  db = new Database(DB_PATH, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Players
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_login INTEGER DEFAULT (strftime('%s','now')),
      renown INTEGER DEFAULT 0,
      prestige_count INTEGER DEFAULT 0,
      prestige_bonuses TEXT DEFAULT '{}',
      online INTEGER DEFAULT 0,
      socket_id TEXT DEFAULT NULL
    )
  `);

  // Villages
  db.exec(`
    CREATE TABLE IF NOT EXISTS villages (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Mon Village',
      tier INTEGER DEFAULT 1,
      town_hall_level INTEGER DEFAULT 1,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Resources
  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      village_id TEXT UNIQUE NOT NULL,
      stone REAL DEFAULT 500,
      iron REAL DEFAULT 300,
      gold REAL DEFAULT 200,
      food REAL DEFAULT 400,
      wood REAL DEFAULT 600,
      magic_energy REAL DEFAULT 100,
      max_stone REAL DEFAULT 5000,
      max_iron REAL DEFAULT 5000,
      max_gold REAL DEFAULT 5000,
      max_food REAL DEFAULT 5000,
      max_wood REAL DEFAULT 5000,
      max_magic_energy REAL DEFAULT 2000,
      last_update INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (village_id) REFERENCES villages(id)
    )
  `);

  // Buildings
  db.exec(`
    CREATE TABLE IF NOT EXISTS buildings (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL,
      type TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      workers_assigned INTEGER DEFAULT 0,
      max_workers INTEGER DEFAULT 5,
      FOREIGN KEY (village_id) REFERENCES villages(id)
    )
  `);

  // Troops
  db.exec(`
    CREATE TABLE IF NOT EXISTS troops (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL,
      type TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      FOREIGN KEY (village_id) REFERENCES villages(id)
    )
  `);

  // Heroes
  db.exec(`
    CREATE TABLE IF NOT EXISTS heroes (
      id TEXT PRIMARY KEY,
      player_id TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT 'Héros',
      level INTEGER DEFAULT 1,
      xp REAL DEFAULT 0,
      skill_points INTEGER DEFAULT 0,
      skills TEXT DEFAULT '{}',
      attack REAL DEFAULT 10,
      defense REAL DEFAULT 10,
      hp REAL DEFAULT 100,
      magic REAL DEFAULT 5,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Inventory
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT DEFAULT 'common',
      effects TEXT DEFAULT '{}',
      equipped INTEGER DEFAULT 0,
      source TEXT DEFAULT 'craft',
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Friends
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (friend_id) REFERENCES players(id)
    )
  `);

  // Campaign Progress
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_progress (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      chapter INTEGER DEFAULT 1,
      episode INTEGER DEFAULT 1,
      stars INTEGER DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Tower Progress
  db.exec(`
    CREATE TABLE IF NOT EXISTS tower_progress (
      id TEXT PRIMARY KEY,
      player_id TEXT UNIQUE NOT NULL,
      current_floor INTEGER DEFAULT 0,
      best_floor INTEGER DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Boss gauntlet progress (40 bosses)
  db.exec(`
    CREATE TABLE IF NOT EXISTS boss_progress (
      id TEXT PRIMARY KEY,
      player_id TEXT UNIQUE NOT NULL,
      highest_boss INTEGER DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Generic multiplayer rooms for tower & boss co-op (1-4 players)
  db.exec(`
    CREATE TABLE IF NOT EXISTS party_rooms (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,            -- 'tower' | 'boss'
      host_id TEXT NOT NULL,
      target INTEGER DEFAULT 1,      -- floor number or boss index
      players TEXT NOT NULL,         -- JSON array of player ids
      contributions TEXT DEFAULT '{}', -- JSON {playerId: {troops}}
      status TEXT DEFAULT 'waiting', -- waiting | done
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  // Migration douce : multiplicateur de récompenses et compteur d'étages nettoyés.
  const partyCols = (db.prepare('PRAGMA table_info(party_rooms)').all() as any[]).map((c) => c.name);
  if (!partyCols.includes('multiplier')) db.exec(`ALTER TABLE party_rooms ADD COLUMN multiplier REAL DEFAULT 1`);
  if (!partyCols.includes('floors_cleared')) db.exec(`ALTER TABLE party_rooms ADD COLUMN floors_cleared INTEGER DEFAULT 0`);

  // Compte administrateur.
  const playerCols = (db.prepare('PRAGMA table_info(players)').all() as any[]).map((c) => c.name);
  if (!playerCols.includes('is_admin')) db.exec(`ALTER TABLE players ADD COLUMN is_admin INTEGER DEFAULT 0`);

  // Tour solo : un étage de progression DISTINCT par multiplicateur.
  const towerCols = (db.prepare('PRAGMA table_info(tower_progress)').all() as any[]).map((c) => c.name);
  if (!towerCols.includes('floors_by_mult')) db.exec(`ALTER TABLE tower_progress ADD COLUMN floors_by_mult TEXT DEFAULT '{}'`);

  // Market Listings
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_listings (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      amount REAL NOT NULL,
      price_per_unit REAL NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Migration douce : début du cycle de forge en cours (timestamp unix), 0 = inactif.
  const buildingCols = (db.prepare('PRAGMA table_info(buildings)').all() as any[]).map((c) => c.name);
  if (!buildingCols.includes('forge_started_at')) {
    db.exec(`ALTER TABLE buildings ADD COLUMN forge_started_at INTEGER DEFAULT 0`);
  }

  // Migration douce des villages : réserve d'ouvriers partagée.
  const villageColumns = (db.prepare('PRAGMA table_info(villages)').all() as any[]).map((c) => c.name);
  if (!villageColumns.includes('worker_pool')) {
    db.exec(`ALTER TABLE villages ADD COLUMN worker_pool INTEGER DEFAULT 10`);
  }

  // Migration douce de l'inventaire : verrou anti-suppression sur un équipement.
  const inventoryCols = (db.prepare('PRAGMA table_info(inventory)').all() as any[]).map((c) => c.name);
  if (!inventoryCols.includes('locked')) {
    db.exec(`ALTER TABLE inventory ADD COLUMN locked INTEGER DEFAULT 0`);
  }

  // Migration douce des héros : chance de critique (passif améliorable).
  const heroCols = (db.prepare('PRAGMA table_info(heroes)').all() as any[]).map((c) => c.name);
  if (!heroCols.includes('crit_level')) {
    db.exec(`ALTER TABLE heroes ADD COLUMN crit_level INTEGER DEFAULT 0`);
  }

  // Migration douce des joueurs : stock d'enchantements craftés (compteur par stat).
  const playerColumns = (db.prepare('PRAGMA table_info(players)').all() as any[]).map((c) => c.name);
  if (!playerColumns.includes('dungeon_keys')) {
    db.exec(`ALTER TABLE players ADD COLUMN dungeon_keys INTEGER DEFAULT 0`);
  }
  if (!playerColumns.includes('key_claim_day')) {
    db.exec(`ALTER TABLE players ADD COLUMN key_claim_day INTEGER DEFAULT 0`);
  }
  if (!playerColumns.includes('key_quest')) {
    db.exec(`ALTER TABLE players ADD COLUMN key_quest TEXT DEFAULT ''`);
  }
  if (!playerColumns.includes('key_quest_day')) {
    db.exec(`ALTER TABLE players ADD COLUMN key_quest_day INTEGER DEFAULT 0`);
  }
  if (!playerColumns.includes('dungeon_run')) {
    db.exec(`ALTER TABLE players ADD COLUMN dungeon_run TEXT DEFAULT ''`);
  }
  if (!playerColumns.includes('boss_pity')) {
    db.exec(`ALTER TABLE players ADD COLUMN boss_pity TEXT DEFAULT ''`);
  }
  if (!playerColumns.includes('hero_campaign')) {
    db.exec(`ALTER TABLE players ADD COLUMN hero_campaign TEXT DEFAULT ''`);
  }
  if (!playerColumns.includes('enchants')) {
    db.exec(`ALTER TABLE players ADD COLUMN enchants TEXT DEFAULT '{}'`);
  }
  // Buffs temporaires actifs (potions) : JSON { buffType: expiresAtUnix }.
  if (!playerColumns.includes('active_buffs')) {
    db.exec(`ALTER TABLE players ADD COLUMN active_buffs TEXT DEFAULT '{}'`);
  }

  // Migration douce du marché : les anciennes bases n'avaient que les ressources.
  // Ces colonnes permettent de lister aussi des équipements sans casser les anciennes offres.
  const marketColumns = (db.prepare('PRAGMA table_info(market_listings)').all() as any[]).map((c) => c.name);
  const addMarketColumn = (name: string, definition: string) => {
    if (!marketColumns.includes(name)) db.exec(`ALTER TABLE market_listings ADD COLUMN ${definition}`);
  };
  addMarketColumn('listing_type', `listing_type TEXT DEFAULT 'resource'`);
  addMarketColumn('item_id', 'item_id TEXT DEFAULT NULL');
  addMarketColumn('item_type', 'item_type TEXT DEFAULT NULL');
  addMarketColumn('item_name', 'item_name TEXT DEFAULT NULL');
  addMarketColumn('item_rarity', 'item_rarity TEXT DEFAULT NULL');
  addMarketColumn('item_effects', `item_effects TEXT DEFAULT '{}'`);
  addMarketColumn('item_source', 'item_source TEXT DEFAULT NULL');

  // Raids
  db.exec(`
    CREATE TABLE IF NOT EXISTS raids (
      id TEXT PRIMARY KEY,
      attacker_id TEXT NOT NULL,
      defender_id TEXT NOT NULL,
      result TEXT DEFAULT 'pending',
      resources_stolen TEXT DEFAULT '{}',
      timestamp INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (attacker_id) REFERENCES players(id),
      FOREIGN KEY (defender_id) REFERENCES players(id)
    )
  `);

  // Leaderboard
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      renown INTEGER DEFAULT 0,
      week_number INTEGER DEFAULT 0,
      rank INTEGER DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Research
  db.exec(`
    CREATE TABLE IF NOT EXISTS research (
      id TEXT PRIMARY KEY,
      village_id TEXT NOT NULL,
      type TEXT NOT NULL,
      level INTEGER DEFAULT 0,
      start_time INTEGER DEFAULT 0,
      completion_time INTEGER DEFAULT 0,
      FOREIGN KEY (village_id) REFERENCES villages(id)
    )
  `);

  // Seasonal Events
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasonal_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date INTEGER NOT NULL,
      end_date INTEGER NOT NULL,
      rewards TEXT DEFAULT '{}',
      active INTEGER DEFAULT 1
    )
  `);

  // Event Participation
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_participation (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      progress REAL DEFAULT 0,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players(id),
      FOREIGN KEY (event_id) REFERENCES seasonal_events(id)
    )
  `);

  // Tower Rooms
  db.exec(`
    CREATE TABLE IF NOT EXISTS tower_rooms (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      multiplier INTEGER DEFAULT 1,
      current_floor INTEGER DEFAULT 1,
      players TEXT DEFAULT '[]',
      status TEXT DEFAULT 'waiting',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  // Chat Messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT DEFAULT 'global',
      timestamp INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  // Duels (1v1 par mise de renommée via le tchat)
  db.exec(`
    CREATE TABLE IF NOT EXISTS duels (
      id TEXT PRIMARY KEY,
      challenger_id TEXT NOT NULL,
      challenger_name TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_name TEXT NOT NULL,
      stake INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  // Sessions : connexion auto pendant 1h via token.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);

  // Configuration globale (difficulté éditable par l'admin) : 1 ligne JSON.
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Compte administrateur par défaut (créé si absent).
  seedAdmin();

  return db;
}

// --- Compte admin ---
export const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD = '*hU15/10/2005';

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM players WHERE username = ?').get(ADMIN_USERNAME) as any;
  let adminId: string;
  if (existing) {
    db.prepare('UPDATE players SET is_admin = 1, password_hash = ? WHERE id = ?').run(ADMIN_PASSWORD, existing.id);
    adminId = existing.id;
  } else {
    adminId = uuidv4();
    db.prepare('INSERT INTO players (id, username, password_hash, renown, prestige_count, is_admin) VALUES (?, ?, ?, 0, 0, 1)')
      .run(adminId, ADMIN_USERNAME, ADMIN_PASSWORD);
  }
  // L'admin a besoin d'un village complet pour que l'état du jeu se charge.
  const hasVillage = db.prepare('SELECT id FROM villages WHERE player_id = ?').get(adminId) as any;
  if (!hasVillage) {
    const villageId = uuidv4();
    db.prepare('INSERT INTO villages (id, player_id, name, tier, town_hall_level) VALUES (?, ?, ?, 1, 1)')
      .run(villageId, adminId, 'Village Admin');
    db.prepare('INSERT INTO resources (id, village_id, stone, iron, gold, food, wood, magic_energy) VALUES (?, ?, 500, 300, 200, 400, 600, 100)')
      .run(uuidv4(), villageId);
    const buildings: [string, number][] = [['town_hall', 0], ['mine', 2], ['lumberjack', 2], ['farm', 2], ['farm', 2]];
    for (const [type, workers] of buildings) {
      db.prepare('INSERT INTO buildings (id, village_id, type, level, workers_assigned, max_workers) VALUES (?, ?, ?, 1, ?, 5)')
        .run(uuidv4(), villageId, type, workers);
    }
    db.prepare('INSERT INTO troops (id, village_id, type, count, level) VALUES (?, ?, ?, 5, 1)')
      .run(uuidv4(), villageId, 'soldier');
    db.prepare('INSERT INTO heroes (id, player_id, name, level, xp, skill_points, skills, attack, defense, hp, magic) VALUES (?, ?, ?, 1, 0, 1, ?, 10, 10, 100, 5)')
      .run(uuidv4(), adminId, 'Admin', '{}');
    db.prepare('INSERT INTO campaign_progress (id, player_id, chapter, episode) VALUES (?, ?, 1, 1)')
      .run(uuidv4(), adminId);
    db.prepare('INSERT INTO tower_progress (id, player_id, current_floor, best_floor) VALUES (?, ?, 0, 0)')
      .run(uuidv4(), adminId);
  }
}

// --- Sauvegardes automatiques de la base ---
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 10;

export function listBackups(): { name: string; size: number; createdAt: number }[] {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, createdAt: Math.floor(st.mtimeMs) };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch { return []; }
}

export function createBackup(): { name: string } {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `backup_${stamp}.db`;
  // VACUUM INTO produit un instantané cohérent même avec le WAL actif.
  db.exec(`VACUUM INTO '${path.join(BACKUP_DIR, name).replace(/'/g, "''")}'`);
  pruneBackups();
  return { name };
}

function pruneBackups() {
  const all = listBackups();
  for (const b of all.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch {}
  }
}

export function restoreBackup(name: string): boolean {
  // sécurité : nom de fichier simple uniquement
  if (!/^backup_[\w.\-]+\.db$/.test(name)) return false;
  const src = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(src)) return false;
  // Avant restauration, on sauvegarde l'état courant.
  try { createBackup(); } catch {}

  // On copie les données du backup dans la base LIVE sans changer de handle
  // (l'application garde la même connexion). Toutes les tables connues sont
  // vidées puis re-remplies depuis le fichier de sauvegarde.
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as any[]).map((r) => r.name);
  const safeSrc = src.replace(/'/g, "''");
  const tx = db.transaction(() => {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`ATTACH DATABASE '${safeSrc}' AS backup_src`);
    for (const t of tables) {
      // ne copie que les tables présentes dans le backup
      const exists = db.prepare(`SELECT name FROM backup_src.sqlite_master WHERE type='table' AND name = ?`).get(t);
      if (!exists) continue;
      db.exec(`DELETE FROM main."${t}"`);
      db.exec(`INSERT INTO main."${t}" SELECT * FROM backup_src."${t}"`);
    }
    db.exec('DETACH DATABASE backup_src');
    db.exec('PRAGMA foreign_keys = ON');
  });
  try { tx(); } catch (e) { console.error('[Backup] restauration échouée', e); try { db.exec('DETACH DATABASE backup_src'); } catch {} return false; }
  return true;
}

// Démarre la sauvegarde automatique toutes les 12h (+ une au lancement).
let backupTimer: any = null;
export function startAutoBackup() {
  try { createBackup(); } catch (e) { console.error('[Backup] échec initial', e); }
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(() => {
    try { createBackup(); console.log('[Backup] sauvegarde automatique effectuée'); }
    catch (e) { console.error('[Backup] échec', e); }
  }, 12 * 60 * 60 * 1000);
}

export function getDB(): Database {
  return db;
}

// --- Persistance de la config de difficulté ---
export function loadDifficultyConfig(): any | null {
  try {
    const row = db.prepare('SELECT data FROM game_config WHERE id = 1').get() as any;
    return row ? JSON.parse(row.data) : null;
  } catch { return null; }
}
export function saveDifficultyConfig(cfg: any): void {
  const data = JSON.stringify(cfg);
  db.prepare('INSERT INTO game_config (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = ?').run(data, data);
}

export function genId(): string {
  return uuidv4();
}
