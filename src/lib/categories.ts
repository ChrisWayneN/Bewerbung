/** Kategorien für den Firmen-Filter. Im UI als <optgroup> "Kategorien"
 *  geführt; intern als Filter-Value "kat:<Name>" übergeben. listJobs
 *  übersetzt das zu company IN (...). */
export const COMPANY_CATEGORIES: Record<string, string[]> = {
  'Rüstung':           ['Hensoldt', 'IABG', 'Helsing', 'Quantum Systems', 'Diehl', 'KNDS'],
  'Robotik':           ['Agile Robots SE', 'Neura Robotics', 'Franka Robotics'],
  'Luft- und Raumfahrt': ['Airbus', 'MTU', 'Isar Aerospace'],
  'Mixed':             ['Siemens', 'Rohde & Schwarz'],
};
