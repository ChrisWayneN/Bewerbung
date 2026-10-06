import * as cheerio from 'cheerio';

/**
 * Heuristische Extraktion der Abschnitte "Aufgaben/Tätigkeiten" und
 * "Qualifikationen/Profil" aus einer Stellenbeschreibung.
 *
 * Vorgehen: HTML (oder Text) wird in eine Folge von Zeilen zerlegt, jeweils mit
 * der Info, ob die Zeile ein Listenpunkt, fett oder eine <h1-6>-Überschrift ist.
 * Überschriften-artige Zeilen werden gegen die Muster unten geprüft und schalten
 * den Sammel-Modus um; alle anderen Zeilen werden dem aktuellen Abschnitt
 * zugeordnet, bis ein Stopp-Abschnitt (Benefits, Über uns, Kontakt …) kommt.
 *
 * Firmen betiteln die Abschnitte sehr unterschiedlich – neue Varianten einfach
 * in TASK_PATTERNS / QUAL_PATTERNS / STOP_PATTERNS ergänzen. Die Muster laufen
 * gegen Kleinschreibung mit ä→ae, ö→oe, ü→ue, ß→ss.
 */

/** Gelten für jede Überschriften-artige Zeile. */
const TASK_PATTERNS: RegExp[] = [
  /\baufgaben?\b/, /aufgabengebiet/, /aufgabenbereich/, /aufgabenschwerpunkt/,
  /\btaetigkeit(en)?\b/, /taetigkeitsbereich/, /taetigkeitsprofil/, /taetigkeitsschwerpunkt/,
  /verantwortlichkeit/, /verantwortungsbereich/, /\b(deine|ihre) verantwortung/,
  /wofuer (du|sie) verantwortlich/, /einsatzgebiet/, /\b(dein|ihr) beitrag/,
  /responsibilit/, /\bduties\b/,
  /what you('|’)?ll (do|be doing|work on|be responsible for)/,
  /what you will (do|be doing|work on|be responsible for)/,
  /\b(your|the|about the|this) (new )?role\b/, /\bin this role\b/, /\babout the job\b/,
  /\b(deine|ihre|die) (neue )?rolle\b/,
  /\b(your|deine|ihre|dein|ihr) (mission|tasks?|job|impact|challenges?|herausforderungen?)\b/,
  /\bherausforderungen\b/,
  /\bwas (dich|sie|euch) erwartet\b/, /\bdas erwartet (dich|sie)\b/,
  /\bdas (machst|tust|bewegst) du\b/, /\bwas du (bei uns )?(machst|tust|bewegst)\b/,
  /\bwas sie (bei uns )?(machen|tun|bewegen)\b/,
  /\bkey (tasks|responsibilities|duties)\b/, /\b(the )?day[- ]to[- ]day\b/, /\byour day\b/,
];
/** Nur für "starke" Überschriften (h1-6, fett oder mit Doppelpunkt) – zu breit für Fließtext. */
const TASK_PATTERNS_STRONG: RegExp[] = [/\bmission\b/, /\byou will\b/, /\brole\b/];

const QUAL_PATTERNS: RegExp[] = [
  /\bqualifikation(en)?\b/, /\bqualifications?\b/, /\bprofile?\b/, /anforderungsprofil/,
  /\bvoraussetzung(en)?\b/, /\banforderung(en)?\b/, /\brequirements?\b/,
  /mitbring/, /\bbringst du mit\b/, /\bbringen sie mit\b/,
  /\b(das|was) zeichnet (dich|sie) aus\b/, /\bwas (dich|sie) auszeichnet\b/,
  /\bdamit ueberzeugst du\b/, /\bdamit ueberzeugen sie\b/, /\bwen wir suchen\b/,
  /\bwer (du|sie) (bist|sind)\b/, /\bwho you are\b/, /\babout you\b/,
  /\b(what )?you bring\b/, /\bwhat we('|’)?re looking for\b/, /\bwhat we are looking for\b/,
  /\bwhat we expect\b/, /\bwas wir (von dir |von ihnen )?erwarten\b/,
  /\b(your|deine|ihre) (background|experience|skills|erfahrungen?|kenntnisse|kompetenzen)\b/,
  /\bmust[- ]haves?\b/, /\bnice[- ]to[- ]haves?\b/, /\bideal candidate\b/,
  /\b(minimum|basic|preferred) qualifications\b/, /\bwhat you('|’)?ll need\b/,
  /\bwhat you need\b/, /\byou('|’)?ll need\b/, /\bwas du kannst\b/, /\bwas sie koennen\b/,
  /\bboarding pass\b/, // Airbus: "Your boarding pass"
  /\bapply if you\b/,  // Helsing: "You should apply if you"
];
const QUAL_PATTERNS_STRONG: RegExp[] = [
  /\bskills\b/, /\bkenntnisse\b/, /\bkompetenzen\b/, /\berfahrung(en)?\b/,
  /\byou have\b/, /\byou are\b/,
];

/** Beenden den aktuellen Abschnitt. Werden VOR Aufgaben/Profil geprüft. */
const STOP_PATTERNS: RegExp[] = [
  /\bwir bieten\b/, /\bwas wir (dir |ihnen )?bieten\b/, /\bdas bieten wir\b/,
  /\b(unser|our) (angebot|offer)\b/, /\b(deine|ihre|your|unsere|our) (vorteile|benefits)\b/,
  /\bbenefits\b/, /\bwe offer\b/, /\bwhat we offer\b/, /\bwhat('|’)?s in it for you\b/,
  /\bdarauf (kannst du dich|koennen sie sich) freuen\b/, /\bfreu dich auf\b/, /\bperks\b/,
  /\bueber uns\b/, /\babout us\b/, /\bwer wir sind\b/, /\bwho we are\b/, /unternehmensprofil/,
  /\bkontakt\b/, /\bcontact\b/, /\bansprechpartner/,
  /\b(deine|ihre) bewerbung\b/, /\bjetzt bewerben\b/, /\bbewirb dich\b/, /\bbewerben sie sich\b/,
  /\bbewerbungsprozess\b/, /\bhow to apply\b/, /\bapply now\b/,
  /\binteresse geweckt\b/, /\bhaben wir (dein|ihr) interesse\b/, /\bnoch fragen\b/,
  /\bchancengleichheit\b/, /\bequal opportunit/, /\bdiversity\b/, /\bvielfalt\b/,
  /\bdatenschutz\b/, /\bprivacy\b/, /\bgut zu wissen\b/, /\bgood to know\b/,
  /\bzusaetzliche informationen\b/, /\badditional information\b/,
  /\bgehalt\b/, /\bverguetung\b/, /\bsalary\b/, /\bcompensation\b/,
  /\bwhy (join|us|you('|’)?ll love)\b/, /\bwarum (wir|du|sie)\b/, /\blife at\b/,
  /^join\b/, /\bworking environment\b/,
];
/** Schwache Stopps: nur wenn nichts anderes passt (z.B. "About Helsing", aber nicht "About the role"). */
const STOP_PATTERNS_WEAK: RegExp[] = [/^ueber\s/, /^about\s/];

/** Typische Schluss-Sätze nach dem Profil. Gelten auch für lange Zeilen, die
 *  keine Überschrift sind (z.B. reiner Text von Workday). */
const STOP_SENTENCES: RegExp[] = [
  /^not a 100 ?% match/, /this job requires an awareness of any potential compliance/,
  /^(company|employment type|experience level|job family|remote type)\s*:/,
  /^wir freuen uns auf (deine|ihre) (online-?)?bewerbung/, /^we look forward to (receiving )?your application/,
  /^(haben wir|hast du|habe ich) (dein|ihr|unser)? ?interesse/, /^interessiert\?/,
  /^(bewirb dich|jetzt bewerben|bewerben sie sich)/, /^we are (an )?equal opportunit/,
  /^(we|wir) (are committed to|setzen uns fuer|stehen fuer) (diversity|vielfalt|chancengleichheit)/,
];

type Kind = 'task' | 'qual' | 'stop';

interface Line {
  text: string;
  li: boolean;     // Listenpunkt (li-Element oder Aufzählungszeichen am Zeilenanfang)
  strong: boolean; // komplett fett gedruckt
  hTag: boolean;   // <h1>…<h6>
}

export interface ExtractedSections {
  tasks: string | null;
  qualifications: string | null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyHeading(text: string, strong: boolean): Kind | null {
  const t = normalize(text).replace(/^[^a-z0-9]+/, ''); // Emojis/Deko am Anfang weg
  if (STOP_PATTERNS.some(r => r.test(t))) return 'stop';
  if (TASK_PATTERNS.some(r => r.test(t))) return 'task';
  if (QUAL_PATTERNS.some(r => r.test(t))) return 'qual';
  if (strong && TASK_PATTERNS_STRONG.some(r => r.test(t))) return 'task';
  if (strong && QUAL_PATTERNS_STRONG.some(r => r.test(t))) return 'qual';
  if (STOP_PATTERNS_WEAK.some(r => r.test(t))) return 'stop';
  return null;
}

const MAX_SECTION_CHARS = 8000;

function sectionsFromLines(lines: Line[]): ExtractedSections {
  let mode: 'task' | 'qual' | null = null;
  const out = { task: [] as string[], qual: [] as string[] };
  const seen = { task: new Set<string>(), qual: new Set<string>() };

  for (const l of lines) {
    const t = l.text;
    if (!l.li) {
      const n = normalize(t).replace(/^[^a-z0-9]+/, '');
      if (STOP_SENTENCES.some(r => r.test(n))) { mode = null; continue; }
    }
    const colon = /[:：]\s*$/.test(t);
    const strongHeading = l.hTag || l.strong || colon;
    const candidate = !l.li && t.length <= 90 && (strongHeading || t.length <= 40);
    if (candidate) {
      const kind = classifyHeading(t, strongHeading);
      // Schwache Kandidaten (kurze Zeile ohne Fettdruck/Doppelpunkt) dürfen einen
      // schon gesammelten Abschnitt nicht wieder öffnen – sonst landet z.B. der
      // Benefit "Abwechslungsreiche Aufgaben" in den Aufgaben. Sie zählen dann
      // als normaler Inhalt.
      const weakReopen = kind !== null && kind !== 'stop' && !strongHeading && out[kind].length > 0;
      if (kind === 'stop') { mode = null; continue; }
      if (kind && !weakReopen) {
        mode = kind;
        // Zweiter Abschnitt derselben Art (z.B. "Must have" + "Nice to have"):
        // Überschrift mitnehmen, damit die Gliederung erhalten bleibt.
        if (out[kind].length > 0) out[kind].push('', t.replace(/[:：]\s*$/, '') + ':');
        continue;
      }
      // Unbekannte echte Überschrift beendet den Abschnitt; fette Zwischenzeilen
      // ohne Treffer (z.B. Unterpunkte) gehören dagegen zum Inhalt.
      if (!kind && l.hTag) { mode = null; continue; }
    }
    if (!mode || t.length > 700) continue;
    const entry = l.li ? '• ' + t : t;
    if (seen[mode].has(entry)) continue; // Seiten mit doppeltem Inhalt (Mobil/Desktop)
    seen[mode].add(entry);
    out[mode].push(entry);
  }

  const join = (arr: string[]) => {
    const s = arr.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return s ? s.slice(0, MAX_SECTION_CHARS) : null;
  };
  return { tasks: join(out.task), qualifications: join(out.qual) };
}

/* ---------------- HTML → Zeilen ---------------- */

const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
  'main', 'aside', 'header', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote',
  'dl', 'dt', 'dd', 'pre', 'figure', 'hr', 'body', 'html',
]);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',');
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'iframe', 'button', 'select', 'option', 'input',
  'textarea', 'nav', 'footer', 'form', 'img', 'video', 'audio', 'template', 'head', 'meta', 'link',
]);
const BULLET_RE = /^([•·▪◦‣∙●○■□►▶✓✔➤→\-–—*]|\d{1,2}[.)])\s+/;

function htmlToLines(html: string): Line[] {
  const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, '\n'));
  $('[role="navigation"], [class*="cookie" i], [id*="cookie" i]').remove();
  const lines: Line[] = [];
  type Run = { all: string; bold: string };

  const inlineText = (node: any, inBold: boolean, acc: Run) => {
    if (node.type === 'text') {
      acc.all += node.data;
      if (inBold) acc.bold += node.data;
      return;
    }
    if (node.type !== 'tag') return;
    const tag = String(node.name).toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    const bold = inBold || tag === 'strong' || tag === 'b' || /^h[1-6]$/.test(tag);
    for (const c of node.children ?? []) inlineText(c, bold, acc);
  };

  const emit = (run: Run, li: boolean, hTag: boolean) => {
    const boldNorm = run.bold.replace(/\s+/g, ' ').trim();
    for (let piece of run.all.split('\n')) {
      piece = piece.replace(/\s+/g, ' ').trim();
      if (!piece) continue;
      let isLi = li;
      const bm = piece.match(BULLET_RE);
      if (bm) {
        isLi = true;
        piece = piece.slice(bm[0].length).trim();
        if (!piece) continue;
      }
      const strong = hTag || (boldNorm.length > 0 && boldNorm.includes(piece));
      lines.push({ text: piece, li: isLi, strong, hTag });
    }
  };

  const walk = (node: any, li: boolean) => {
    let run: Run = { all: '', bold: '' };
    const flush = () => {
      if (run.all.trim()) emit(run, li, false);
      run = { all: '', bold: '' };
    };
    for (const c of node.children ?? []) {
      if (c.type === 'text') { run.all += c.data; continue; }
      if (c.type !== 'tag') continue;
      const tag = String(c.name).toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const r: Run = { all: '', bold: '' };
        inlineText(c, true, r);
        emit({ all: r.all.replace(/\n/g, ' '), bold: r.bold.replace(/\n/g, ' ') }, li, true);
        continue;
      }
      if (BLOCK_TAGS.has(tag) || $(c).find(BLOCK_SELECTOR).length > 0) {
        flush();
        walk(c, li || tag === 'li');
        continue;
      }
      inlineText(c, false, run);
    }
    flush();
  };

  const root = $('body').get(0) ?? $.root().get(0);
  walk(root, false);
  return lines;
}

function textToLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let t = raw.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    let li = false;
    const bm = t.match(BULLET_RE);
    if (bm) {
      li = true;
      t = t.slice(bm[0].length).trim();
      if (!t) continue;
    }
    lines.push({ text: t, li, strong: false, hTag: false });
  }
  return lines;
}

export function extractSectionsFromHtml(html: string): ExtractedSections {
  if (!html) return { tasks: null, qualifications: null };
  return sectionsFromLines(htmlToLines(html));
}

/** Variante für Beschreibungen, die als reiner Text kommen (Workday/SAP). */
export function extractSectionsFromText(text: string): ExtractedSections {
  if (!text) return { tasks: null, qualifications: null };
  return sectionsFromLines(textToLines(text));
}

/** HTML oder Text – je nachdem, ob Tags enthalten sind. */
export function extractSections(input: string): ExtractedSections {
  return /<[a-z][\s\S]*>/i.test(input) ? extractSectionsFromHtml(input) : extractSectionsFromText(input);
}

/** Entfernt aktive Inhalte (Skripte, Event-Handler, Formulare) aus fremdem HTML,
 *  bevor es gespeichert und auf der Detailseite als Roh-Beschreibung gerendert wird. */
export function sanitizeHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, object, embed, form, input, button, select, textarea, link, meta, svg, img, video, audio').remove();
  $('*').each((_, el: any) => {
    const tag = String(el.name).toLowerCase();
    for (const name of Object.keys(el.attribs ?? {})) {
      const keep = tag === 'a' && name === 'href' && /^(https?:|mailto:)/i.test(el.attribs[name]);
      if (!keep) $(el).removeAttr(name);
    }
  });
  return ($('body').html() ?? '').trim();
}
