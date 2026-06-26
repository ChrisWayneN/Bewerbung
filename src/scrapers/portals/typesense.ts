import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob } from '../base';

/**
 * Typesense Multi-Search API – wird von my-job-shop.com (talentsconnect-Backend)
 * sowie vielen anderen Karriereseiten genutzt. Endpoint-Form:
 *   POST {apiUrl}?x-typesense-api-key=...
 *   { "searches": [{ "collection": "offers", "q": "*", "page": 1, ... }] }
 * Response:
 *   { "results": [{ "found": N, "hits": [{ "document": { ... } }] }] }
 * Der x-typesense-api-key ist ein „Scoped Search Key" – am Ende des Strings
 * steckt ein base64-encodeter Filter (z. B. tenant_id:=neura-robotics).
 */

interface TypesenseHit { document: Record<string, any>; highlights?: any[]; }
interface TypesenseSearchResult { found?: number; hits?: TypesenseHit[]; page?: number; }
interface TypesenseMultiSearchResponse { results?: TypesenseSearchResult[] }

export interface TypesenseConfig {
  company: string;
  apiUrl: string;
  searchBody: { searches: Array<Record<string, any>> };
  buildDetailUrl: (doc: Record<string, any>) => string | null;
  /** Optional: Felder-Mapping, falls die Defaults nicht passen. */
  pickTitle?: (doc: Record<string, any>) => string | null;
  pickLocation?: (doc: Record<string, any>) => string | null;
  sourcePortal: string;
  maxPages?: number;
  /** Origin/Referer-Host der Karriereseite (für CORS-Header). */
  originHost?: string;
}

function defaultTitle(doc: Record<string, any>): string | null {
  return doc.title ?? doc.name ?? doc.position_title ?? doc.jobTitle ?? null;
}

function defaultLocation(doc: Record<string, any>): string | null {
  const v = doc.location ?? doc.full_address ?? doc.city ?? doc.locationName ?? doc.office;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  if (v && typeof v === 'object') {
    return (v.name ?? v.city ?? v.label ?? JSON.stringify(v)).toString();
  }
  return null;
}

export async function scrapeTypesense(cfg: TypesenseConfig): Promise<JobInput[]> {
  const out: JobInput[] = [];
  const seen = new Set<string>();
  const maxPages = cfg.maxPages ?? 20;
  let firstPageDebugged = false;

  // Den API-Key aus der URL ziehen, um ihn zusätzlich als Header zu senden
  // (manche Proxys verlangen den Header zwingend und lehnen URL-only ab).
  let parsedApiKey: string | null = null;
  try {
    const u = new URL(cfg.apiUrl);
    parsedApiKey = u.searchParams.get('x-typesense-api-key');
  } catch { /* ignore */ }

  const origin = cfg.originHost ?? 'https://jobs.neura-robotics.com';

  for (let page = 1; page <= maxPages; page++) {
    const body = JSON.parse(JSON.stringify(cfg.searchBody));
    for (const s of body.searches) s.page = page;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      origin,
      referer: origin + '/',
    };
    if (parsedApiKey) headers['x-typesense-api-key'] = parsedApiKey;

    const res = await fetch(cfg.apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Typesense HTTP ${res.status} (${cfg.company})${errText ? ' – ' + errText.slice(0, 200) : ''}`);
    }
    const data = (await res.json()) as TypesenseMultiSearchResponse;
    const result = data.results?.[0];
    const hits = result?.hits ?? [];
    if (!hits.length) break;

    if (!firstPageDebugged && process.env.SCRAPE_DEBUG === '1') {
      console.log(`  [debug ${cfg.company}] erster Hit Felder:`, Object.keys(hits[0].document || {}));
      firstPageDebugged = true;
    }

    let addedThisPage = 0;
    for (const hit of hits) {
      const doc = hit.document || {};
      const title = (cfg.pickTitle ?? defaultTitle)(doc);
      const location = (cfg.pickLocation ?? defaultLocation)(doc);
      if (!title) continue;
      if (!isMunichArea(location ?? '')) continue;
      const url = cfg.buildDetailUrl(doc);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const job: JobInput = {
        company: cfg.company,
        title,
        location,
        url,
        source_portal: cfg.sourcePortal,
      };
      job.hash = hashJob(job);
      out.push(job);
      addedThisPage++;
    }

    const perPage = body.searches[0]?.per_page ?? 25;
    if (hits.length < perPage) break;
    if (addedThisPage === 0 && page > 1) break;
  }

  return out;
}
