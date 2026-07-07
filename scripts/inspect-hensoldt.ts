#!/usr/bin/env node
/**
 * Diagnose-Script für den Hensoldt-Scraper (SAP SuccessFactors, jobs.hensoldt.net).
 * Hensoldt hat auf ein neues "job-tile"-DOM umgestellt (li.job-tile mit data-url
 * und a.jobTitle-link). Dieses Script prüft:
 *   1. Gesamtzahl der Treffer laut Seite ("Showing X to Y of Z Jobs")
 *   2. Wie Titel + Standort im neuen Tile-DOM stehen (voller HTML-Dump je Tile)
 *   3. Ob die aktuelle Location-Extraktion versehentlich ein "Locations"-Label
 *      statt des Ortswertes greift
 *   4. Pro Seite: wie viele Tiles, wie viele davon München-Area (Paginierungs-Test)
 *
 *   npm run inspect-hensoldt
 *   npm run inspect-hensoldt > hensoldt-debug.txt
 */
import * as cheerio from 'cheerio';
import { fetchText, isMunichArea } from '../src/scrapers/base';

const BASE = 'https://jobs.hensoldt.net';
const COUNTRY_URL = (startrow: number) =>
  `${BASE}/search/?createNewAlert=false&q=&optionsFacetsDD_country=DE&startrow=${startrow}`;

function showTotal(html: string) {
  // SF rendert "Showing 1 to 25 of 137 Jobs" bzw. eine Total-Zahl irgendwo.
  const m =
    html.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+([\d,.]+)\s+Jobs/i) ||
    html.match(/of\s+([\d,.]+)\s+Jobs/i) ||
    html.match(/(\d+)\s+Jobs?\s*(?:gefunden|found)/i);
  console.log(`▶ Total laut Seite: ${m ? m[1] : '(nicht gefunden)'}`);
}

function dumpTiles(html: string, max = 2) {
  const $ = cheerio.load(html);
  const tiles = $('li.job-tile, .job-tile, tr[class*="job"], li[class*="job"]');
  console.log(`\n== Tile-Container gefunden: ${tiles.length} (selector li.job-tile etc.) ==`);
  tiles.slice(0, max).each((i, el) => {
    console.log(`\n--- Tile ${i + 1} (voller HTML, whitespace-komprimiert) ---`);
    const raw = $.html(el).replace(/>\s+</g, '><');
    console.log(raw.slice(0, 2500));
  });
}

function testExtraction(html: string) {
  const $ = cheerio.load(html);
  const links = $('a.jobTitle-link, a[id*="jobTitle"]');
  console.log(`\n== Extraktions-Test: ${links.length} a.jobTitle-link ==`);
  links.slice(0, 8).each((_, a) => {
    const $a = $(a);
    const title = $a.text().trim().replace(/\s+/g, ' ');
    const row = $a.closest('tr, li, .data-row, .job-tile, .jobItem, article');
    // aktuelle (kaputte?) Logik:
    const locNodeText = row.find('.jobLocation, [class*="location" i]').first().text().trim().replace(/\s+/g, ' ');
    const rowText = row.text().trim().replace(/\s+/g, ' ');
    const currentLoc = (locNodeText || rowText).replace(/\s+/g, ' ');
    // Alternativen:
    const dataUrl = row.attr('data-url') || $a.attr('href') || '';
    const decodedUrl = (() => { try { return decodeURIComponent(dataUrl); } catch { return dataUrl; } })();
    console.log(`\n  • "${title.slice(0, 60)}"`);
    console.log(`      location-node text  : "${locNodeText.slice(0, 80)}"`);
    console.log(`      => aktuell genutzt  : "${currentLoc.slice(0, 80)}"  → isMunichArea=${isMunichArea(currentLoc)}`);
    console.log(`      data-url/href       : "${decodedUrl.slice(0, 100)}"  → isMunichArea=${isMunichArea(decodedUrl)}`);
    console.log(`      row.text isMunich   : ${isMunichArea(rowText)}`);
  });
}

async function main() {
  console.log(`▶ Hensoldt-Diagnose (SuccessFactors, neues Tile-DOM)`);
  console.log(`▶ Fetch: ${COUNTRY_URL(0)}`);
  const html0 = await fetchText(COUNTRY_URL(0));
  console.log(`▶ HTML: ${html0.length} bytes`);
  showTotal(html0);
  dumpTiles(html0);
  testExtraction(html0);

  // Paginierungs-Test: pro Seite Tiles + München-Treffer zählen
  console.log(`\n\n== Paginierungs-Test (country=DE, 25/Seite) ==`);
  const pageSize = 25;
  let totalTiles = 0;
  let totalMunich = 0;
  for (let startrow = 0; startrow < 500; startrow += pageSize) {
    let html: string;
    try {
      html = startrow === 0 ? html0 : await fetchText(COUNTRY_URL(startrow));
    } catch (e) {
      console.log(`  startrow=${startrow}: FETCH-FEHLER ${(e as Error).message}`);
      break;
    }
    const $ = cheerio.load(html);
    const links = $('a.jobTitle-link, a[id*="jobTitle"]');
    if (!links.length) { console.log(`  startrow=${startrow}: 0 Links → Ende`); break; }
    let munich = 0;
    links.each((_, a) => {
      const $a = $(a);
      const row = $a.closest('tr, li, .data-row, .job-tile, .jobItem, article');
      const dataUrl = row.attr('data-url') || $a.attr('href') || '';
      const decoded = (() => { try { return decodeURIComponent(dataUrl); } catch { return dataUrl; } })();
      if (isMunichArea(decoded) || isMunichArea(row.text())) munich++;
    });
    totalTiles += links.length;
    totalMunich += munich;
    console.log(`  startrow=${startrow}: ${links.length} Tiles, ${munich} München-Area`);
    if (links.length < pageSize) { console.log(`  (letzte Seite)`); break; }
  }
  console.log(`\n▶ Summe: ${totalTiles} Tiles gesamt, ${totalMunich} München-Area`);
  console.log(`\n▶ Fertig.`);
}

main().catch(e => { console.error(e); process.exit(1); });
