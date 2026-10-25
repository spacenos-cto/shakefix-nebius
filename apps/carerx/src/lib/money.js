// USD money helpers (integer cents inside, 2 dp outside). Shared by browser and server.
export const toCents = (amount) => Math.round(Number(amount) * 100);
export const fromCents = (cents) => Math.round(cents) / 100;

/** "$12.00" */
export function formatUsd(amount) {
  const cents = toCents(amount);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}
