import * as cheerio from 'cheerio';

/**
 * Heuristically extract the "Aufgaben/Tätigkeiten" and
 * "Qualifikationen/Profil/Voraussetzungen" sections from a job description.
 *
 * Strategy: walk headings/strong elements in DOM order; when a heading matches
 * one of the section names, accumulate the following sibling content (lists,
 * paragraphs) until the next heading or until obvious unrelated content
 * (Benefits, "Wir bieten", "Über uns", contact info).
 */
const TASK_HEADINGS = [
  /aufgabe/i, /aufgaben/i, /t[aä]tigkeit/i, /your role/i, /ihre rolle/i,
  /your tasks/i, /your mission/i, /verantwortung/i, /responsibilit/i,
  /what you'?ll do/i, /das erwartet dich/i, /dein aufgabengebiet/i,
];
const QUAL_HEADINGS = [
  /qualifikation/i, /profil/i, /voraussetzung/i, /anforderung/i,
  /your profile/i, /requirements/i, /you bring/i, /what you bring/i,
  /skills/i, /das bringst du mit/i, /dein profil/i, /your qualifications/i,
];
const STOP_HEADINGS = [
  /wir bieten/i, /we offer/i, /benefit/i, /angebot/i, /über uns/i,
  /about us/i, /kontakt/i, /contact/i, /ansprechpartner/i,
  /bewerbung/i, /application/i, /interessiert/i,
];

export interface ExtractedSections {
  tasks: string | null;
  qualifications: string | null;
}

export function extractSectionsFromHtml(html: string): ExtractedSections {
  if (!html) return { tasks: null, qualifications: null };
  const $ = cheerio.load(html);

  // Remove scripts/styles up-front
  $('script, style, noscript').remove();

  const blocks: { kind: 'task' | 'qual' | 'stop' | 'none'; text: string }[] = [];
  const headingSel = 'h1,h2,h3,h4,h5,h6,strong,b,p';

  let mode: 'task' | 'qual' | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (mode && buf.length) {
      blocks.push({ kind: mode, text: buf.join('\n').trim() });
    }
    buf = [];
  };

  $('body *').each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    if (!tag) return;
    const $el = $(el);
    const text = $el.text().trim();
    if (!text) return;

    // Heading-like elements
    if (/^(h[1-6]|strong|b)$/.test(tag) || (tag === 'p' && $el.find('strong,b').length && text.length < 80)) {
      const t = text;
      if (STOP_HEADINGS.some(r => r.test(t))) {
        flush();
        mode = null;
        return;
      }
      if (TASK_HEADINGS.some(r => r.test(t))) { flush(); mode = 'task'; return; }
      if (QUAL_HEADINGS.some(r => r.test(t))) { flush(); mode = 'qual'; return; }
    }

    // Content collectors when in a mode: lists and paragraphs
    if (mode && (tag === 'ul' || tag === 'ol')) {
      $el.find('li').each((_, li) => {
        const liText = $(li).text().trim().replace(/\s+/g, ' ');
        if (liText) buf.push('• ' + liText);
      });
    } else if (mode && tag === 'li') {
      // already handled by parent ul/ol; skip
    } else if (mode && tag === 'p' && text.length > 0 && text.length < 600) {
      buf.push(text.replace(/\s+/g, ' '));
    }
  });
  flush();

  const tasks = blocks.filter(b => b.kind === 'task').map(b => b.text).join('\n').trim() || null;
  const qualifications = blocks.filter(b => b.kind === 'qual').map(b => b.text).join('\n').trim() || null;
  return { tasks, qualifications };
}

/**
 * Plain-text variant for descriptions that come back as text (Workday/SAP).
 * Splits on heading-like lines.
 */
export function extractSectionsFromText(text: string): ExtractedSections {
  if (!text) return { tasks: null, qualifications: null };
  const lines = text.split(/\r?\n/);
  let mode: 'task' | 'qual' | null = null;
  const out = { task: [] as string[], qual: [] as string[] };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (STOP_HEADINGS.some(r => r.test(line)) && line.length < 80) { mode = null; continue; }
    if (TASK_HEADINGS.some(r => r.test(line)) && line.length < 80) { mode = 'task'; continue; }
    if (QUAL_HEADINGS.some(r => r.test(line)) && line.length < 80) { mode = 'qual'; continue; }
    if (mode) out[mode].push(line.startsWith('•') || line.startsWith('-') ? line : '• ' + line);
  }
  return {
    tasks: out.task.length ? out.task.join('\n') : null,
    qualifications: out.qual.length ? out.qual.join('\n') : null,
  };
}
