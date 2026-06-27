/** Kategorien für den Firmen-Filter. Im UI als <optgroup> "Kategorien"
 *  geführt; intern als Filter-Value "kat:<Name>" übergeben. listJobs
 *  übersetzt das zu company IN (...). */
export const COMPANY_CATEGORIES: Record<string, string[]> = {
  'Rüstung':  ['Hensoldt', 'IABG', 'Helsing', 'Quantum Systems', 'Diehl', 'MTU', 'KNDS'],
  'Robotik':  ['Agile Robots SE', 'Neura Robotics', 'Franka Robotics'],
  'Mixed':    ['Siemens', 'Rohde & Schwarz'],
};
