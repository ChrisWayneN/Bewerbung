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
  // RobCo: "We're looking for someone who has:" – nur am Zeilenanfang, sonst trifft es Fließtext.
  /^(we('|’)?re|we are) (also )?looking for (someone|somebody|a person|people|candidates?|you)\b/,
];
const QUAL_PATTERNS_STRONG: RegExp[] = [
  /\bskills\b/, /\bkenntnisse\b/, /\bkompetenzen\b/, /\berfahrung(en)?\b/,
  // Nur am Zeilenanfang ("You are …:") – sonst trifft z.B. "The page you are trying to access".
  /^you have\b/, /^you are\b/,
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

/** Formatierung einer Überschriften-artigen Zeile. */
function headingStyle(l: Line): 'h' | 'b' | 'colon' | null {
  if (l.hTag) return 'h';
  if (l.strong) return 'b';
  if (/[:：]\s*$/.test(l.text)) return 'colon';
  return null;
}

/** Platzhaltertext aus Stellen-Vorlagen ("Lorem Ipsum", bei KNDS auch "Lorem Impsum"). */
const PLACEHOLDER_RE = /\blorem\s+im?psum\b|\bdolor sit amet\b/i;
function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_RE.test(text) && text.replace(PLACEHOLDER_RE, '').replace(/[^a-zäöüß]+/gi, '').length < 40;
}

/** Beschreibung besteht nur aus Vorlagen-Platzhaltern (z.B. API-Feld noch nicht
 *  befüllt) – dann taugt sie nicht als Quelle, die echte Seite muss geladen werden. */
export function isPlaceholderDescription(raw: string | null | undefined): boolean {
  if (!raw || !PLACEHOLDER_RE.test(raw)) return false;
  const s = extractSections(raw);
  return !s.tasks && !s.qualifications;
}

function sectionsFromLines(lines: Line[]): ExtractedSections {
  // Wie sehen die erkannten Überschriften in DIESER Anzeige aus (h3? fetter
  // Absatz?). Eine unbekannte Zeile im selben Stil ist sehr wahrscheinlich
  // ebenfalls eine Abschnitts-Überschrift (nur anders formuliert) und beendet
  // den Abschnitt – sonst landet z.B. ein unbekannt betiteltes Profil in den
  // Aufgaben. Lieber fehlt etwas sichtbar, als dass es falsch zugeordnet wird.
  const knownStyles = new Set<string>();
  for (const l of lines) {
    const style = headingStyle(l);
    if (style && !l.li && l.text.length <= 90 && classifyHeading(l.text, true)) knownStyles.add(style);
  }

  let mode: 'task' | 'qual' | null = null;
  const out = { task: [] as string[], qual: [] as string[] };
  const seen = { task: new Set<string>(), qual: new Set<string>() };
  // Zwischenüberschrift eines zweiten Abschnitts derselben Art – erst übernehmen,
  // wenn auch Inhalt folgt (sonst stehen leere "Ihre Aufgaben:"-Zeilen im Ergebnis).
  const pending = { task: null as string | null, qual: null as string | null };

  for (const l of lines) {
    const t = l.text;
    if (isPlaceholder(t)) continue;
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
        pending[kind] = out[kind].length > 0 ? t.replace(/[:：]\s*$/, '') + ':' : null;
        continue;
      }
      // Unbekannte Überschrift im Stil der bekannten (oder echte <h1-6>) beendet
      // den Abschnitt; anders formatierte Zwischenzeilen (z.B. fette Unterpunkte
      // unter <h3>-Abschnitten) gehören dagegen zum Inhalt.
      const style = headingStyle(l);
      if (!kind && (l.hTag || (style && knownStyles.has(style)))) { mode = null; continue; }
    }
    if (!mode || t.length > 700) continue;
    const entry = l.li ? '• ' + t : t;
    if (seen[mode].has(entry)) continue; // Seiten mit doppeltem Inhalt (Mobil/Desktop)
    seen[mode].add(entry);
    if (pending[mode]) { out[mode].push('', pending[mode]!); pending[mode] = null; }
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

function isHtml(input: string): boolean {
  return /<[a-z][\s\S]*>/i.test(input);
}

/** HTML oder Text – je nachdem, ob Tags enthalten sind. */
export function extractSections(input: string): ExtractedSections {
  return isHtml(input) ? extractSectionsFromHtml(input) : extractSectionsFromText(input);
}

/** Hinweisseiten statt Stellenanzeige: Stelle besetzt/abgelaufen, nur intern,
 *  oder Weiterleitung auf die Job-Übersicht (Greenhouse macht das bei
 *  geschlossenen Stellen). Muster gegen normalisierten Text (ä→ae usw.). */
const CLOSED_PATTERNS: RegExp[] = [
  /\bposition has been (filled|closed)\b/, /\bthis (job|position|posting|vacancy) (is|has been) (closed|filled|expired)\b/,
  /\b(job|position|posting|vacancy) (is )?no longer (available|active|open|online)\b/,
  /\bno longer accepting applications\b/, /\b(job|posting) has expired\b/,
  /\bpage you are trying to access is for employees\b/,
  /\bthe job you are looking for (is no longer|could not be found|does not exist)\b/,
  /\bcurrent openings at\b/, // Greenhouse-Übersicht nach Umleitung
  /\b(stelle|stellenanzeige|anzeige|position) (ist|wurde) (leider )?(bereits )?(besetzt|vergeben|geschlossen)\b/,
  /\b(stelle|stellenanzeige|anzeige|stellenangebot) (ist )?(leider )?nicht mehr (verfuegbar|aktiv|online|ausgeschrieben|vorhanden)\b/,
  /\bdiese stelle (existiert|gibt es) (leider )?nicht mehr\b/,
];

/** true, wenn der Text nach einer Hinweisseite "Stelle nicht mehr verfügbar"
 *  aussieht. Nur zusammen mit einer fehlgeschlagenen Extraktion verwenden – eine
 *  echte Anzeige mit Aufgaben UND Profil gilt nie als geschlossen. */
export function looksLikeClosedPosting(input: string): boolean {
  let text = input;
  if (isHtml(input)) {
    // Nur Hauptinhalt: ein Footer-/Widget-Satz wie "Diese Stelle ist nicht mehr
    // verfügbar, falls …" darf eine echte Anzeige nicht als geschlossen markieren.
    const $ = cheerio.load(input);
    $('script, style, noscript, nav, footer, form, aside, [role="navigation"], [class*="cookie" i], [id*="cookie" i]').remove();
    text = $.root().text();
  }
  const t = normalize(text.slice(0, 50_000));
  return CLOSED_PATTERNS.some(r => r.test(t));
}

/** Diagnose: alle Überschriften-artigen Zeilen einer Beschreibung samt Zuordnung
 *  (null = unbekannt). Zeigt, welche Firmen-Formulierung in den Mustern fehlt. */
export function explainHeadings(input: string): { text: string; kind: Kind | null }[] {
  const lines = isHtml(input) ? htmlToLines(input) : textToLines(input);
  const out: { text: string; kind: Kind | null }[] = [];
  for (const l of lines) {
    const strongHeading = l.hTag || l.strong || /[:：]\s*$/.test(l.text);
    if (l.li || l.text.length > 90 || !strongHeading) continue;
    out.push({ text: l.text, kind: classifyHeading(l.text, strongHeading) });
  }
  return out;
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
