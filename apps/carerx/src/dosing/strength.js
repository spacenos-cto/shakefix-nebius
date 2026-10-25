// Medication strength display. Shared by the browser (src/) and the API server.
// Policy: apps/carerx/src/dosing/** is supervised (.shakefix/policy.yml): a pharmacist approves
// every change here, whatever Fix Confidence says.

const UNITS = ['mg', 'mcg', 'g', 'mL', 'units'];

export function isKnownUnit(unit) {
  return UNITS.includes(unit);
}

/** "25 mg", "50 mcg". */
export function formatStrength(value, unit) {
  return `${value} ${unit}`;
}
