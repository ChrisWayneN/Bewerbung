CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  url TEXT NOT NULL UNIQUE,
  source_portal TEXT,
  description_raw TEXT,
  tasks TEXT,
  qualifications TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  hash TEXT,
  rating TEXT,         -- 'A' | 'AB' | 'B' | NULL
  status TEXT          -- 'gelesen' | 'beworben' | 'prozess' | 'abgelehnt' | NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen);
CREATE INDEX IF NOT EXISTS idx_jobs_hidden ON jobs(hidden);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  jobs_found INTEGER NOT NULL DEFAULT 0,
  jobs_new INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS scraper_status (
  company TEXT PRIMARY KEY,
  status TEXT,            -- 'ok' | 'partial' | 'fail'
  last_run TEXT,
  jobs_found INTEGER,
  error TEXT
);

-- URLs, die der User ausgeblendet hat. Überlebt Auto-Prune und Wieder-
-- auftauchen einer Stelle: upsertJobs prüft beim INSERT, ob die URL hier
-- steht, und setzt dann hidden=1 statt 0.
CREATE TABLE IF NOT EXISTS hidden_urls (
  url TEXT PRIMARY KEY,
  hidden_at TEXT NOT NULL
);

-- URL-stabile A/B-Bewertung. Selbe Logik wie hidden_urls: überlebt
-- Auto-Prune und Wiederauftauchen. rating ∈ {'A', 'AB', 'B'}.
CREATE TABLE IF NOT EXISTS rated_urls (
  url TEXT PRIMARY KEY,
  rating TEXT NOT NULL,
  rated_at TEXT NOT NULL
);

-- URL-stabile Bewerbungs-Status. Selbe Logik wie rated_urls.
-- status ∈ {'gelesen', 'beworben', 'prozess', 'abgelehnt'}.
-- "Neu" ist KEIN persistierter Status, sondern abgeleitet aus
-- (status IS NULL AND first_seen > letzter Import-Baseline).
CREATE TABLE IF NOT EXISTS status_urls (
  url TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  set_at TEXT NOT NULL
);

-- FTS5 virtual table for full-text search.
CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(
  title, company, location, tasks, qualifications, description_raw,
  content='jobs', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS jobs_ai AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts(rowid, title, company, location, tasks, qualifications, description_raw)
  VALUES (new.id, new.title, new.company, new.location, new.tasks, new.qualifications, new.description_raw);
END;
CREATE TRIGGER IF NOT EXISTS jobs_ad AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, location, tasks, qualifications, description_raw)
  VALUES('delete', old.id, old.title, old.company, old.location, old.tasks, old.qualifications, old.description_raw);
END;
CREATE TRIGGER IF NOT EXISTS jobs_au AFTER UPDATE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, location, tasks, qualifications, description_raw)
  VALUES('delete', old.id, old.title, old.company, old.location, old.tasks, old.qualifications, old.description_raw);
  INSERT INTO jobs_fts(rowid, title, company, location, tasks, qualifications, description_raw)
  VALUES (new.id, new.title, new.company, new.location, new.tasks, new.qualifications, new.description_raw);
END;
