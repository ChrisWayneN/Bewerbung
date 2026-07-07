import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.JOBS_DB_PATH || resolve(process.cwd(), 'db', 'jobs.db');
const SCHEMA_PATH = resolve(process.cwd(), 'db', 'schema.sql');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  if (existsSync(SCHEMA_PATH)) {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  // Migration: rating/status-Spalten auf existierender jobs-Tabelle. CREATE
  // TABLE IF NOT EXISTS fügt keine Spalten zu vorhandenen Tabellen hinzu.
  const cols = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'rating')) {
    db.exec("ALTER TABLE jobs ADD COLUMN rating TEXT");
  }
  if (!cols.some(c => c.name === 'status')) {
    db.exec("ALTER TABLE jobs ADD COLUMN status TEXT");
  }
  // Backfill: bestehende hidden=1-Jobs in hidden_urls übernehmen, falls
  // die Tabelle leer ist (z.B. nach Schema-Migration). Idempotent durch
  // INSERT OR IGNORE.
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM hidden_urls').get() as { c: number };
  if (cnt.c === 0) {
    db.exec(`
      INSERT OR IGNORE INTO hidden_urls (url, hidden_at)
      SELECT url, COALESCE(last_seen, first_seen) FROM jobs WHERE hidden = 1
    `);
  }
  // Backfill rated_urls aus jobs.rating (für bestehende Markierungen).
  const ratedCnt = db.prepare('SELECT COUNT(*) AS c FROM rated_urls').get() as { c: number };
  if (ratedCnt.c === 0) {
    db.exec(`
      INSERT OR IGNORE INTO rated_urls (url, rating, rated_at)
      SELECT url, rating, COALESCE(last_seen, first_seen) FROM jobs
      WHERE rating IS NOT NULL AND rating != ''
    `);
  }
  // Backfill status_urls aus jobs.status (analog).
  const statusCnt = db.prepare('SELECT COUNT(*) AS c FROM status_urls').get() as { c: number };
  if (statusCnt.c === 0) {
    db.exec(`
      INSERT OR IGNORE INTO status_urls (url, status, set_at)
      SELECT url, status, COALESCE(last_seen, first_seen) FROM jobs
      WHERE status IS NOT NULL AND status != ''
    `);
  }
  _db = db;
  return db;
}

export interface JobRow {
  id: number;
  company: string;
  title: string;
  location: string | null;
  url: string;
  source_portal: string | null;
  description_raw: string | null;
  tasks: string | null;
  qualifications: string | null;
  first_seen: string;
  last_seen: string;
  hidden: number;
  hash: string | null;
  rating: string | null;
  status: string | null;
}

export type JobRating = 'A' | 'AB' | 'B';
export type JobStatus = 'gelesen' | 'beworben' | 'prozess' | 'abgelehnt';

export interface JobInput {
  company: string;
  title: string;
  location?: string | null;
  url: string;
  source_portal?: string | null;
  description_raw?: string | null;
  tasks?: string | null;
  qualifications?: string | null;
  hash?: string | null;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  ids: number[];
}

export function upsertJobs(jobs: JobInput[]): UpsertResult {
  const db = getDb();
  const now = new Date().toISOString();
  const select = db.prepare('SELECT id, hash FROM jobs WHERE url = ?');
  const isHidden = db.prepare('SELECT 1 FROM hidden_urls WHERE url = ?');
  const getRating = db.prepare('SELECT rating FROM rated_urls WHERE url = ?');
  const getStatus = db.prepare('SELECT status FROM status_urls WHERE url = ?');
  const insert = db.prepare(`
    INSERT INTO jobs (company, title, location, url, source_portal, description_raw,
      tasks, qualifications, first_seen, last_seen, hidden, hash, rating, status)
    VALUES (@company, @title, @location, @url, @source_portal, @description_raw,
      @tasks, @qualifications, @first_seen, @last_seen, @hidden, @hash, @rating, @status)
  `);
  const update = db.prepare(`
    UPDATE jobs SET title=@title, location=@location, source_portal=@source_portal,
      description_raw=@description_raw, tasks=@tasks, qualifications=@qualifications,
      last_seen=@last_seen, hash=@hash
    WHERE id=@id
  `);

  let inserted = 0,
    updated = 0;
  const ids: number[] = [];

  const tx = db.transaction((batch: JobInput[]) => {
    for (const j of batch) {
      const existing = select.get(j.url) as { id: number; hash: string | null } | undefined;
      const row = {
        company: j.company,
        title: j.title,
        location: j.location ?? null,
        url: j.url,
        source_portal: j.source_portal ?? null,
        description_raw: j.description_raw ?? null,
        tasks: j.tasks ?? null,
        qualifications: j.qualifications ?? null,
        first_seen: now,
        last_seen: now,
        hash: j.hash ?? null,
      };
      if (!existing) {
        const hidden = isHidden.get(j.url) ? 1 : 0;
        const ratingRow = getRating.get(j.url) as { rating: string } | undefined;
        const rating = ratingRow?.rating ?? null;
        const statusRow = getStatus.get(j.url) as { status: string } | undefined;
        const status = statusRow?.status ?? null;
        const r = insert.run({ ...row, hidden, rating, status });
        inserted++;
        ids.push(Number(r.lastInsertRowid));
      } else {
        update.run({ ...row, id: existing.id });
        if (existing.hash !== j.hash) updated++;
        ids.push(existing.id);
      }
    }
  });
  tx(jobs);
  return { inserted, updated, ids };
}

export function recordImportRun(stats: { jobs_found: number; jobs_new: number; notes?: string }) {
  const db = getDb();
  db.prepare('INSERT INTO imports (run_at, jobs_found, jobs_new, notes) VALUES (?, ?, ?, ?)').run(
    new Date().toISOString(),
    stats.jobs_found,
    stats.jobs_new,
    stats.notes ?? null,
  );
}

export function recordScraperStatus(company: string, status: 'ok' | 'partial' | 'fail', jobsFound: number, error?: string) {
  const db = getDb();
  db.prepare(`
    INSERT INTO scraper_status (company, status, last_run, jobs_found, error)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company) DO UPDATE SET
      status=excluded.status, last_run=excluded.last_run,
      jobs_found=excluded.jobs_found, error=excluded.error
  `).run(company, status, new Date().toISOString(), jobsFound, error ?? null);
}

/**
 * "New since previous import" baseline = the run_at of the second-to-last import.
 * On the very first import, returns ISO epoch so everything counts as new.
 */
export function getPreviousImportTimestamp(): string {
  const db = getDb();
  const row = db
    .prepare('SELECT run_at FROM imports ORDER BY id DESC LIMIT 1 OFFSET 1')
    .get() as { run_at: string } | undefined;
  return row?.run_at ?? '1970-01-01T00:00:00.000Z';
}

export type JobSort = 'rating-desc' | 'rating-asc' | 'status-asc' | 'status-desc';

export interface ListFilters {
  q?: string;
  /** Einzel-Firmenname ODER "kat:<Kategoriename>" für eine Gruppe. */
  company?: string;
  onlyNew?: boolean;
  /** Zeigt hidden=1-Stellen, die NICHT abgelehnt sind (manuell ausgeblendet). */
  includeHidden?: boolean;
  /** Zeigt status='abgelehnt'-Stellen (per Klick auf "5: Abgelehnt"). */
  includeRejected?: boolean;
  /** Nur A-bewertete Stellen anzeigen. */
  onlyA?: boolean;
  /** Nur Stellen mit status='beworben'. */
  onlyApplied?: boolean;
  /** Nur Stellen mit status='prozess'. Wenn beide aktiv: OR. */
  onlyInProcess?: boolean;
  sort?: JobSort;
}

export function listJobs(filters: ListFilters = {}): (JobRow & { is_new: boolean })[] {
  const db = getDb();
  const baseline = getPreviousImportTimestamp();
  const params: Record<string, unknown> = { baseline };
  const where: string[] = [];

  // Sichtbarkeit: hidden=0 immer sichtbar.
  //   includeHidden  → manuell ausgeblendete (hidden=1, status != 'abgelehnt')
  //   includeRejected → abgelehnte (hidden=1, status='abgelehnt')
  {
    const vis: string[] = ['j.hidden = 0'];
    if (filters.includeRejected) vis.push("(j.hidden = 1 AND j.status = 'abgelehnt')");
    if (filters.includeHidden)   vis.push("(j.hidden = 1 AND (j.status IS NULL OR j.status != 'abgelehnt'))");
    where.push('(' + vis.join(' OR ') + ')');
  }
  if (filters.company) {
    if (filters.company.startsWith('kat:')) {
      // Lazy import, damit das DB-Modul keinen harten Import auf die
      // Kategorie-Liste hat (die wird auch im UI gebraucht).
      const { COMPANY_CATEGORIES } = require('./categories') as typeof import('./categories');
      const cat = filters.company.slice(4);
      const list = COMPANY_CATEGORIES[cat];
      if (list && list.length > 0) {
        const ph = list.map((_, i) => `@cat${i}`).join(',');
        where.push(`j.company IN (${ph})`);
        list.forEach((c, i) => { params[`cat${i}`] = c; });
      } else {
        where.push('1=0'); // unbekannte Kategorie → leeres Ergebnis
      }
    } else {
      where.push('j.company = @company');
      params.company = filters.company;
    }
  }
  if (filters.onlyNew) where.push('j.first_seen > @baseline');
  if (filters.onlyA) where.push("j.rating = 'A'");
  if (filters.onlyApplied && filters.onlyInProcess) {
    where.push("j.status IN ('beworben', 'prozess')");
  } else if (filters.onlyApplied) {
    where.push("j.status = 'beworben'");
  } else if (filters.onlyInProcess) {
    where.push("j.status = 'prozess'");
  }

  const orderBy = buildOrderBy(filters.sort);

  let sql: string;
  if (filters.q && filters.q.trim()) {
    // FTS5 MATCH; sanitize: keep alphanumerics+space, fall back to LIKE if empty
    const cleaned = filters.q.replace(/["']/g, ' ').trim();
    if (cleaned) {
      params.q = cleaned.split(/\s+/).map(t => t + '*').join(' ');
      sql = `
        SELECT j.*, (j.first_seen > @baseline) AS is_new
        FROM jobs j
        JOIN jobs_fts f ON f.rowid = j.id
        WHERE jobs_fts MATCH @q ${where.length ? 'AND ' + where.join(' AND ') : ''}
        ${orderBy}
        LIMIT 1000
      `;
    } else {
      sql = baseSelect(where, orderBy);
    }
  } else {
    sql = baseSelect(where, orderBy);
  }
  const rows = db.prepare(sql).all(params) as (JobRow & { is_new: number })[];
  return rows.map(r => ({ ...r, is_new: !!r.is_new }));
}

function baseSelect(where: string[], orderBy: string): string {
  return `
    SELECT j.*, (j.first_seen > @baseline) AS is_new
    FROM jobs j
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ${orderBy}
    LIMIT 1000
  `;
}

function buildOrderBy(sort: JobSort | undefined): string {
  // Stellen ohne passenden Sort-Schlüssel landen immer am Ende (Priorität 9).
  if (sort === 'rating-desc') {
    return "ORDER BY CASE j.rating WHEN 'A' THEN 1 WHEN 'AB' THEN 2 WHEN 'B' THEN 3 ELSE 9 END ASC, j.first_seen DESC, j.id DESC";
  }
  if (sort === 'rating-asc') {
    return "ORDER BY CASE j.rating WHEN 'B' THEN 1 WHEN 'AB' THEN 2 WHEN 'A' THEN 3 ELSE 9 END ASC, j.first_seen DESC, j.id DESC";
  }
  // Status-Reihenfolge (1→5): Neu, Gelesen, Beworben, Prozess, Abgelehnt.
  // "Neu" = first_seen > Baseline UND status IS NULL.
  if (sort === 'status-asc') {
    return `ORDER BY CASE
      WHEN j.status IS NULL AND j.first_seen > @baseline THEN 1
      WHEN j.status = 'gelesen' THEN 2
      WHEN j.status = 'beworben' THEN 3
      WHEN j.status = 'prozess' THEN 4
      WHEN j.status = 'abgelehnt' THEN 5
      ELSE 9 END ASC, j.first_seen DESC, j.id DESC`;
  }
  if (sort === 'status-desc') {
    return `ORDER BY CASE
      WHEN j.status = 'abgelehnt' THEN 1
      WHEN j.status = 'prozess' THEN 2
      WHEN j.status = 'beworben' THEN 3
      WHEN j.status = 'gelesen' THEN 4
      WHEN j.status IS NULL AND j.first_seen > @baseline THEN 5
      ELSE 9 END ASC, j.first_seen DESC, j.id DESC`;
  }
  return 'ORDER BY j.first_seen DESC, j.id DESC';
}

export function getJob(id: number): (JobRow & { is_new: boolean }) | null {
  const db = getDb();
  const baseline = getPreviousImportTimestamp();
  const row = db
    .prepare('SELECT j.*, (j.first_seen > ?) AS is_new FROM jobs j WHERE id = ?')
    .get(baseline, id) as (JobRow & { is_new: number }) | undefined;
  return row ? { ...row, is_new: !!row.is_new } : null;
}

export function setHidden(id: number, hidden: boolean): void {
  const db = getDb();
  const row = db.prepare('SELECT url FROM jobs WHERE id = ?').get(id) as { url: string } | undefined;
  const tx = db.transaction(() => {
    db.prepare('UPDATE jobs SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
    if (!row) return;
    if (hidden) {
      db.prepare('INSERT OR IGNORE INTO hidden_urls (url, hidden_at) VALUES (?, ?)').run(row.url, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM hidden_urls WHERE url = ?').run(row.url);
    }
  });
  tx();
}

/** Setzt oder löscht (status=null) den Bewerbungs-Status einer Stelle.
 *  Synchronisiert hidden: status='abgelehnt' → hidden=1, alles andere → hidden=0.
 *  Persistiert URL-stabil in status_urls und hidden_urls (überlebt Auto-Prune). */
export function setStatus(id: number, status: JobStatus | null): void {
  const db = getDb();
  const row = db.prepare('SELECT url FROM jobs WHERE id = ?').get(id) as { url: string } | undefined;
  const hidden = status === 'abgelehnt' ? 1 : 0;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE jobs SET status = ?, hidden = ? WHERE id = ?').run(status, hidden, id);
    if (!row) return;
    if (status) {
      db.prepare(`
        INSERT INTO status_urls (url, status, set_at) VALUES (?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET status=excluded.status, set_at=excluded.set_at
      `).run(row.url, status, now);
    } else {
      db.prepare('DELETE FROM status_urls WHERE url = ?').run(row.url);
    }
    if (hidden) {
      db.prepare('INSERT OR IGNORE INTO hidden_urls (url, hidden_at) VALUES (?, ?)').run(row.url, now);
    } else {
      db.prepare('DELETE FROM hidden_urls WHERE url = ?').run(row.url);
    }
  });
  tx();
}

/** Setzt oder löscht (rating=null) die A/B-Bewertung einer Stelle.
 *  Persistiert URL-stabil in rated_urls (überlebt Auto-Prune). */
export function setRating(id: number, rating: JobRating | null): void {
  const db = getDb();
  const row = db.prepare('SELECT url FROM jobs WHERE id = ?').get(id) as { url: string } | undefined;
  const tx = db.transaction(() => {
    db.prepare('UPDATE jobs SET rating = ? WHERE id = ?').run(rating, id);
    if (!row) return;
    if (rating) {
      db.prepare(`
        INSERT INTO rated_urls (url, rating, rated_at) VALUES (?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET rating=excluded.rating, rated_at=excluded.rated_at
      `).run(row.url, rating, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM rated_urls WHERE url = ?').run(row.url);
    }
  });
  tx();
}

export function listCompanies(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT company FROM jobs ORDER BY company').all() as { company: string }[];
  return rows.map(r => r.company);
}

/** Stellen-Anzahl pro Firma, optional unter Berücksichtigung von
 *  onlyNew (seit letztem Import) und includeHidden. Wird im Firmen-
 *  Dropdown angezeigt und reagiert daher auf dieselben Checkboxen. */
export function getCompanyCounts(filters: { onlyNew?: boolean; includeHidden?: boolean; includeRejected?: boolean; onlyA?: boolean; onlyApplied?: boolean; onlyInProcess?: boolean } = {}): Record<string, number> {
  const db = getDb();
  const baseline = getPreviousImportTimestamp();
  const where: string[] = [];
  const params: Record<string, unknown> = { baseline };
  {
    const vis: string[] = ['j.hidden = 0'];
    if (filters.includeRejected) vis.push("(j.hidden = 1 AND j.status = 'abgelehnt')");
    if (filters.includeHidden)   vis.push("(j.hidden = 1 AND (j.status IS NULL OR j.status != 'abgelehnt'))");
    where.push('(' + vis.join(' OR ') + ')');
  }
  if (filters.onlyNew) where.push('j.first_seen > @baseline');
  if (filters.onlyA) where.push("j.rating = 'A'");
  if (filters.onlyApplied && filters.onlyInProcess) {
    where.push("j.status IN ('beworben', 'prozess')");
  } else if (filters.onlyApplied) {
    where.push("j.status = 'beworben'");
  } else if (filters.onlyInProcess) {
    where.push("j.status = 'prozess'");
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT j.company AS company, COUNT(*) AS c FROM jobs j ${whereClause} GROUP BY j.company`).all(params) as Array<{ company: string; c: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.company] = r.c;
  return out;
}

export function getScraperStatuses(): { company: string; status: string; last_run: string; jobs_found: number; error: string | null }[] {
  return getDb().prepare('SELECT * FROM scraper_status ORDER BY company').all() as any;
}

/** Löscht DB-Einträge einer Firma, deren URL nicht in keepUrls vorkommt.
 *  Wird nach einem erfolgreichen Scrape aufgerufen, um Geister-Einträge
 *  (frühere Fehlmatches oder offline genommene Stellen) zu entfernen.
 *  Nur aufrufen, wenn der Scrape mindestens eine Stelle geliefert hat,
 *  damit ein leerer/kaputter Lauf nicht die ganze Firma leert.
 *  Stellen mit aktivem Status (gelesen/beworben/prozess) oder Bewertung sind
 *  vom Prune ausgenommen – die dürfen nicht verschwinden, nur weil ein
 *  Scrape-Lauf sie mal nicht liefert (Karriereseite offline genommen,
 *  Pagination-Hickup, Blacklist-Update). status_urls überlebt zwar den
 *  Prune, aber nur um den Status wiederherzustellen falls die URL erneut
 *  auftaucht – verschwindet sie für immer, war die Stelle sonst komplett weg. */
export function deleteStaleJobsForCompany(company: string, keepUrls: Iterable<string>): { deleted: number; samples: string[] } {
  const keep = new Set(keepUrls);
  const db = getDb();
  const all = db.prepare('SELECT id, title, url, status, rating FROM jobs WHERE company = ?').all(company) as
    { id: number; title: string; url: string; status: string | null; rating: string | null }[];
  const toDelete: { id: number; title: string }[] = [];
  for (const row of all) {
    if (keep.has(row.url)) continue;
    if (row.status && row.status !== 'abgelehnt') continue;
    if (row.rating) continue;
    toDelete.push({ id: row.id, title: row.title });
  }
  if (!toDelete.length) return { deleted: 0, samples: [] };
  const tx = db.transaction((ids: number[]) => {
    const del = db.prepare('DELETE FROM jobs WHERE id = ?');
    for (const id of ids) del.run(id);
  });
  tx(toDelete.map(d => d.id));
  return { deleted: toDelete.length, samples: toDelete.slice(0, 5).map(d => d.title) };
}

/** Löscht alle Jobs, deren Titel eines der Blacklist-Keywords als Phrase enthält
 *  (case-insensitive, Trenner-tolerant, Wortgrenzen-Match für kurze Begriffe ≤ 3 Zeichen).
 *  Stellen mit aktivem Status (gelesen/beworben/prozess) oder Bewertung sind
 *  ausgenommen – ein nachträglich erweitertes Blacklist-Wort darf keine
 *  bereits verfolgte Bewerbung aus der DB reißen. */
export function deleteJobsByTitleKeywords(keywords: string[]): { deleted: number; samples: string[] } {
  if (!keywords.length) return { deleted: 0, samples: [] };
  // Lazy import um Reihenfolge-Probleme bei Modul-Loading zu vermeiden.
  const { normalizeForMatch, matchNeedle } = require('./blacklist') as typeof import('./blacklist');
  const needles = keywords.map(normalizeForMatch);

  const db = getDb();
  const all = db.prepare('SELECT id, title, status, rating FROM jobs').all() as
    { id: number; title: string; status: string | null; rating: string | null }[];
  const toDelete: number[] = [];
  const samples: string[] = [];
  for (const row of all) {
    if (row.status && row.status !== 'abgelehnt') continue;
    if (row.rating) continue;
    const hay = normalizeForMatch(row.title ?? '');
    if (needles.some(n => matchNeedle(hay, n))) {
      toDelete.push(row.id);
      if (samples.length < 5) samples.push(row.title);
    }
  }
  if (!toDelete.length) return { deleted: 0, samples: [] };
  const tx = db.transaction((ids: number[]) => {
    const del = db.prepare('DELETE FROM jobs WHERE id = ?');
    for (const id of ids) del.run(id);
  });
  tx(toDelete);
  return { deleted: toDelete.length, samples };
}
