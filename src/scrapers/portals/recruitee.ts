import type { JobInput } from '../../lib/db';
import { isMunichArea, hashJob } from '../base';

/**
 * Recruitee Public Offers API (öffentlich, ohne Auth):
 *   GET https://{tenant}.recruitee.com/api/offers/
 *   GET https://{customDomain}/api/offers/      (CNAME-Setup)
 * Response: { "offers": [{ id, slug, title, city, country, location, department,
 *                          careers_url, ... }] }
 */

export interface RecruiteeConfig {
  company: string;
  /** Recruitee-Tenant-Slug, z. B. 'quantum-systems' (= {slug}.recruitee.com). */
  tenant: string;
  /** Optional zusätzliche Karriere-Domain (CNAME), z. B. 'career.quantum-systems.com'. */
  customDomain?: string;
  sourcePortal?: string;
}

interface RecruiteeOffer {
  id?: number | string;
  slug?: string;
  title?: string;
  city?: string;
  country?: string;
  state_code?: string;
  location?: string;
  department?: string;
  careers_url?: string;
  careers_apply_url?: string;
  tags?: string[];
  employment_type_code?: string;
}

export async function scrapeRecruitee(cfg: RecruiteeConfig): Promise<JobInput[]> {
  const tenant = cfg.tenant.replace(/\/$/, '');
  const candidates = [
    `https://${tenant}.recruitee.com/api/offers/`,
    cfg.customDomain ? `https://${cfg.customDomain.replace(/\/$/, '')}/api/offers/` : null,
  ].filter(Boolean) as string[];

  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) {
        lastErr = new Error(`Recruitee HTTP ${res.status} for ${url}`);
        continue;
      }
      const data = (await res.json()) as { offers?: RecruiteeOffer[] };
      const offers = data.offers ?? [];
      const out: JobInput[] = [];
      const seen = new Set<string>();
      for (const o of offers) {
        const title = o.title;
        const location = o.location ?? [o.city, o.country].filter(Boolean).join(', ');
        if (!title) continue;
        if (!isMunichArea(location)) continue;
        const detailUrl = o.careers_url
          ?? (cfg.customDomain && o.slug ? `https://${cfg.customDomain.replace(/\/$/, '')}/o/${o.slug}` : null)
          ?? (o.slug ? `https://${tenant}.recruitee.com/o/${o.slug}` : null);
        if (!detailUrl || seen.has(detailUrl)) continue;
        seen.add(detailUrl);
        const job: JobInput = {
          company: cfg.company,
          title,
          location,
          url: detailUrl,
          source_portal: cfg.sourcePortal ?? 'recruitee',
        };
        job.hash = hashJob(job);
        out.push(job);
      }
      return out;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error(`Recruitee: keine API-URL erreichbar für tenant=${tenant}`);
}
