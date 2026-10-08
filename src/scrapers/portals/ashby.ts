import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob, fetchJson, fetchText } from '../base';

/**
 * Ashby Job-Boards (jobs.ashbyhq.com/{board}), z. B. eingebettet auf rob.co/karriere.
 *
 * Zwei öffentliche Quellen, beide ohne Auth:
 *   1. GraphQL des Job-Boards (das nutzt auch das Embed auf der Firmenseite):
 *        POST https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams
 *      → Teams (= Abteilungen) und Stellen MIT den internen IDs. Nur hier lassen
 *        sich die URL-Filter ?ashby_department_id=…&ashby_location_id=… 1:1 anwenden.
 *   2. Posting-API:
 *        GET https://api.ashbyhq.com/posting-api/job-board/{board}
 *      → Stellen mit Abteilungs-/Ortsnamen und descriptionHtml (für Aufgaben/Profil),
 *        aber ohne IDs.
 *
 * Gefiltert wird über (1); die Beschreibungen kommen aus (2). Fällt (1) aus,
 * wird (2) über Abteilungsname + isMunichArea() gefiltert.
 */

export interface AshbyConfig {
  company: string;
  /** Kandidaten für den Board-Namen (jobs.ashbyhq.com/{board}); der erste, der Stellen liefert, gewinnt. */
  boards: string[];
  /** Karriereseite mit eingebettetem Board – daraus wird der Board-Name gelesen, falls vorhanden. */
  careersPage?: string;
  /** Wert von ?ashby_department_id= (inkl. aller Unter-Teams). */
  departmentId?: string;
  /** Wert von ?ashby_location_id= (Haupt- oder Zusatzstandort). */
  locationId?: string;
  /** Fallback ohne GraphQL: Abteilungs-/Teamname, der passen muss. */
  departmentName?: RegExp;
}

interface GqlTeam { id: string; name?: string; parentTeamId?: string | null }
interface GqlPosting {
  id: string;
  title: string;
  teamId?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  secondaryLocations?: Array<{ locationId?: string | null; locationName?: string | null }> | null;
}

export interface AshbyPosting {
  id: string;
  title: string;
  department?: string | null;
  team?: string | null;
  location?: string | null;
  secondaryLocations?: Array<{ location?: string | null }> | null;
  isListed?: boolean;
  jobUrl?: string;
  descriptionHtml?: string | null;
}

const GQL_URL = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams';
const GQL_QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    teams { id name parentTeamId }
    jobPostings { id title teamId locationId locationName secondaryLocations { locationId locationName } }
  }
}`;

async function fetchGraphql(board: string): Promise<{ teams: GqlTeam[]; jobPostings: GqlPosting[] } | null> {
  const res = await fetchJson<{ data?: { jobBoard?: { teams: GqlTeam[]; jobPostings: GqlPosting[] } | null } }>(GQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: 'ApiJobBoardWithTeams',
      variables: { organizationHostedJobsPageName: board },
      query: GQL_QUERY,
    }),
  });
  return res.data?.jobBoard ?? null;
}

export async function fetchAshbyPostings(board: string): Promise<AshbyPosting[]> {
  const res = await fetchJson<{ jobs?: AshbyPosting[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=false`,
  );
  return (res.jobs ?? []).filter(j => j.isListed !== false);
}

/** Board-Namen aus dem Embed der Karriereseite lesen (jobs.ashbyhq.com/<board>/…). */
async function boardFromCareersPage(url: string): Promise<string | null> {
  try {
    const html = await fetchText(url);
    const m = html.match(/jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/);
    return m && m[1] !== 'api' ? m[1] : null;
  } catch {
    return null;
  }
}

/** departmentId + alle (Unter-)Teams darunter. */
function teamIdsUnder(teams: GqlTeam[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of teams) {
      if (t.parentTeamId && ids.has(t.parentTeamId) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
    }
  }
  return ids;
}

function postingDescription(p: AshbyPosting | undefined): string | null {
  return p?.descriptionHtml?.trim() ? p.descriptionHtml : null;
}

export async function scrapeAshby(cfg: AshbyConfig): Promise<JobInput[]> {
  const fromPage = cfg.careersPage ? await boardFromCareersPage(cfg.careersPage) : null;
  const boards = [...new Set([fromPage, ...cfg.boards].filter((b): b is string => !!b))];

  const errors: string[] = [];
  for (const board of boards) {
    // Beschreibungen (Posting-API) – optional, ohne sie lädt die Anreicherung nach.
    let postings: AshbyPosting[] = [];
    try {
      postings = await fetchAshbyPostings(board);
    } catch (e) {
      errors.push(`posting-api ${board}: ${e instanceof Error ? e.message : e}`);
    }
    const byId = new Map(postings.map(p => [p.id, p]));

    let gql: Awaited<ReturnType<typeof fetchGraphql>> = null;
    try {
      gql = await fetchGraphql(board);
    } catch (e) {
      errors.push(`graphql ${board}: ${e instanceof Error ? e.message : e}`);
    }

    const out: JobInput[] = [];
    const push = (id: string, title: string, locations: (string | null | undefined)[]) => {
      const locs = locations.filter((l): l is string => !!l?.trim());
      const job: JobInput = {
        company: cfg.company,
        title: title.trim().replace(/\s+/g, ' '),
        location: locs.find(l => isMunichArea(l)) ?? locs[0] ?? 'München',
        url: `https://jobs.ashbyhq.com/${board}/${id}`,
        source_portal: 'ashby',
        description_raw: postingDescription(byId.get(id)),
      };
      job.hash = hashJob(job);
      out.push(job);
    };

    if (gql && gql.jobPostings.length) {
      const teamIds = cfg.departmentId ? teamIdsUnder(gql.teams, cfg.departmentId) : null;
      let deptOut = 0, locOut = 0;
      for (const p of gql.jobPostings) {
        if (teamIds && !(p.teamId && teamIds.has(p.teamId))) { deptOut++; continue; }
        const secondary = p.secondaryLocations ?? [];
        if (cfg.locationId) {
          if (p.locationId !== cfg.locationId && !secondary.some(s => s.locationId === cfg.locationId)) { locOut++; continue; }
        } else if (![p.locationName, ...secondary.map(s => s.locationName)].some(l => isMunichArea(l))) {
          locOut++; continue;
        }
        push(p.id, p.title, [p.locationName, ...secondary.map(s => s.locationName)]);
      }
      if (!out.length) {
        const known = cfg.departmentId && !gql.teams.some(t => t.id === cfg.departmentId) ? ' – Abteilungs-ID unbekannt!' : '';
        console.log(`  [debug ${cfg.company}] Board "${board}": ${gql.jobPostings.length} Stellen, ${deptOut} an Abteilung${known}, ${locOut} am Standort gefiltert.`);
      }
      return out;
    }

    if (postings.length) {
      // Fallback ohne IDs: Abteilungsname + Ortsname.
      for (const p of postings) {
        if (cfg.departmentName && !cfg.departmentName.test(`${p.department ?? ''} ${p.team ?? ''}`)) continue;
        const locs = [p.location, ...(p.secondaryLocations ?? []).map(s => s.location)];
        if (!locs.some(l => isMunichArea(l))) continue;
        push(p.id, p.title, locs);
      }
      console.log(`  [debug ${cfg.company}] GraphQL nicht verfügbar – Fallback über Posting-API (Board "${board}", ${out.length} von ${postings.length} Stellen).`);
      return out;
    }
  }
  throw new Error(`Ashby-Board nicht gefunden (versucht: ${boards.join(', ')})${errors.length ? ` – ${errors.join('; ')}` : ''}`);
}
