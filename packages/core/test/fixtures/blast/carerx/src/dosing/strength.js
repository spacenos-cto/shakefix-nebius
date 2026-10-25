// Medication strength display. Shared by the browser (src/) and the API server.
// Policy: apps/carerx/src/dosing/** is supervised (.shakefix/policy.yml): a pharmacist approves
// every change here, whatever Fix Confidence says.

const UNITS = ['mg', 'mcg', 'g', 'mL', 'units'];

export function isKnownUnit(unit) {
  return UNITS.includes(unit);
}

/** "25 mg", "50 mcg". */
export function formatStrength(value, unit) {
  // SEEDED BUG C4: micrograms are shown as milligrams, so 50 mcg of levothyroxine reads as
  // "50 mg" on screen: a 1000x overstatement of the dose.
  const shown = unit === 'mcg' ? 'mg' : unit;
  return `${value} ${shown}`;
}
