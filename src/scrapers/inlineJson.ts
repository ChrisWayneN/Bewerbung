/**
 * Utilities um in einer SPA-HTML-Antwort eingebetteten JSON-State zu finden,
 * ohne Browser-Rendering. SPAs hängen ihre Server-Side-Data oft hier rein:
 *   - <script id="__NEXT_DATA__" type="application/json">{...}</script>   (Next.js)
 *   - <script type="application/json" data-…>…</script>
 *   - <script>window.__NUXT__=…</script>                                  (Nuxt)
 *   - <script>window.__INITIAL_STATE__=…</script>                          (Vue/React)
 *   - <script>window.__APOLLO_STATE__=…</script>                           (Apollo)
 *   - <script type="application/ld+json">…</script>                        (SEO JobPosting)
 */
import * as cheerio from 'cheerio';

export interface InlineJsonHit {
  source: string;
  data: unknown;
}

/** Liefert alle parsebaren JSON-Objekte aus den üblichen SPA-Slots. */
export function extractInlineJson(html: string): InlineJsonHit[] {
  const $ = cheerio.load(html);
  const out: InlineJsonHit[] = [];

  // <script id="__NEXT_DATA__"> etc.
  $('script[type="application/json"]').each((_, el) => {
    const id = $(el).attr('id') || $(el).attr('data-id') || 'json-script';
    const txt = $(el).contents().text().trim();
    if (!txt) return;
    try { out.push({ source: id, data: JSON.parse(txt) }); } catch { /* skip */ }
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text().trim();
    if (!txt) return;
    try { out.push({ source: 'ld+json', data: JSON.parse(txt) }); } catch { /* skip */ }
  });

  // window.__NUXT__ = {...};  /  window.__INITIAL_STATE__ = {...};
  const windowAssignPatterns: { name: string; re: RegExp }[] = [
    { name: '__NUXT__', re: /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/ },
    { name: '__INITIAL_STATE__', re: /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/ },
    { name: '__APOLLO_STATE__', re: /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/ },
    { name: '__PRELOADED_STATE__', re: /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/ },
  ];
  for (const p of windowAssignPatterns) {
    const m = p.re.exec(html);
    if (m) {
      try { out.push({ source: p.name, data: JSON.parse(m[1]) }); } catch { /* skip */ }
    }
  }

  return out;
}

/**
 * Walk durch ein JSON-Objekt und sammelt alle Sub-Werte, die plausibel
 * Job-Listen sind (Array von Objekten mit { title|name } und einem location-/href-Feld).
 */
export function findJobArrays(value: unknown, path: string = '$', maxDepth = 12): { path: string; jobs: any[] }[] {
  const hits: { path: string; jobs: any[] }[] = [];
  function visit(v: unknown, p: string, d: number) {
    if (d > maxDepth || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (v.length >= 1 && v.length <= 5000 && v.every(it => it && typeof it === 'object')) {
        const sample = v[0] as Record<string, unknown>;
        const titleKey = ['title', 'name', 'jobTitle', 'positionTitle', 'displayName'].find(k => typeof sample[k] === 'string');
        if (titleKey) {
          hits.push({ path: p, jobs: v });
        }
      }
      v.forEach((it, i) => visit(it, `${p}[${i}]`, d + 1));
    } else {
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        visit(vv, `${p}.${k}`, d + 1);
      }
    }
  }
  visit(value, path, 0);
  return hits;
}

/** Wert aus erstem nicht-leerem Feld holen. */
export function pickString(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
