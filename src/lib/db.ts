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
}

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
  const insert = db.prepare(`
    INSERT INTO jobs (company, title, location, url, source_portal, description_raw,
      tasks, qualifications, first_seen, last_seen, hidden, hash)
    VALUES (@company, @title, @location, @url, @source_portal, @description_raw,
      @tasks, @qualifications, @first_seen, @last_seen, 0, @hash)
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
        const r = insert.run(row);
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

export interface ListFilters {
  q?: string;
  company?: string;
  onlyNew?: boolean;
  includeHidden?: boolean;
}

export function listJobs(filters: ListFilters = {}): (JobRow & { is_new: boolean })[] {
  const db = getDb();
  const baseline = getPreviousImportTimestamp();
  const params: Record<string, unknown> = { baseline };
  const where: string[] = [];

  if (!filters.includeHidden) where.push('j.hidden = 0');
  if (filters.company) {
    where.push('j.company = @company');
    params.company = filters.company;
  }
  if (filters.onlyNew) where.push('j.first_seen > @baseline');

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
        ORDER BY j.first_seen DESC, j.id DESC
        LIMIT 1000
      `;
    } else {
      sql = baseSelect(where, baseline);
    }
  } else {
    sql = baseSelect(where, baseline);
  }
  const rows = db.prepare(sql).all(params) as (JobRow & { is_new: number })[];
  return rows.map(r => ({ ...r, is_new: !!r.is_new }));
}

function baseSelect(where: string[], _baseline: string): string {
  return `
    SELECT j.*, (j.first_seen > @baseline) AS is_new
    FROM jobs j
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY j.first_seen DESC, j.id DESC
    LIMIT 1000
  `;
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
  getDb().prepare('UPDATE jobs SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
}

export function listCompanies(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT company FROM jobs ORDER BY company').all() as { company: string }[];
  return rows.map(r => r.company);
}

export function getScraperStatuses(): { company: string; status: string; last_run: string; jobs_found: number; error: string | null }[] {
  return getDb().prepare('SELECT * FROM scraper_status ORDER BY company').all() as any;
}

/** Löscht alle Jobs, deren Titel eines der Blacklist-Keywords als Phrase enthält
 *  (case-insensitive, Trenner-tolerant – „Software Engineer" matcht auch „Software-Engineer"). */
export function deleteJobsByTitleKeywords(keywords: string[]): { deleted: number; samples: string[] } {
  if (!keywords.length) return { deleted: 0, samples: [] };
  // Inline-Normalisierung, um zirkuläre Imports zu vermeiden.
  const normalize = (s: string) => s.toLowerCase().replace(/[-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  const needles = keywords.map(normalize);

  const db = getDb();
  const all = db.prepare('SELECT id, title FROM jobs').all() as { id: number; title: string }[];
  const toDelete: number[] = [];
  const samples: string[] = [];
  for (const row of all) {
    const hay = normalize(row.title ?? '');
    if (needles.some(n => hay.includes(n))) {
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
