/** Öffentliche KNDS-Stellenanzeige (jobs.knds.de). Früher wurde stattdessen die
 *  SAP-Bewerbungsseite gespeichert, die nur eine Login-Maske zeigt. */
export function kndsJobUrl(reqId: string | number, locale = 'de_DE'): string {
  return `https://jobs.knds.de/job-invite/${reqId}/?locale=${locale}`;
}

/** Alte SAP-Bewerbungs-URL → neue Anzeigen-URL (null, wenn keine alte KNDS-URL). */
export function kndsUrlFromLegacy(url: string): string | null {
  if (!url.startsWith('https://career55.sapsf.eu/career?')) return null;
  const p = new URL(url).searchParams;
  const reqId = p.get('career_job_req_id');
  if (p.get('company') !== 'kraussma01' || !reqId) return null;
  return kndsJobUrl(reqId, p.get('lang') ?? 'de_DE');
}
