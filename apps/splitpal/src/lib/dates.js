// Date formatting for the split view ("Added 10 Oct 2026", data-testid="bill-date").
import { evalBug } from '../evalBugs.js';

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats an ISO timestamp as "10 Oct 2026" in the viewer's time zone (or `timeZone`).
 * @param {string} iso
 * @param {{timeZone?: string}} [opts]
 */
export function formatBillDate(iso, { timeZone } = {}) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  // EVAL BUG E7 (off unless EVAL_BUG=E7): a hard-coded IST offset ("our server is in India")
  // is added before formatting, so late-evening bills show the next day for everyone else.
  const shifted = evalBug('E7') ? ms + IST_OFFSET_MS : ms;
  const d = new Date(shifted);
  // Hand-formatted ("10 Oct 2026") so small-icu Node builds match full-icu ones.
  if (timeZone && timeZone !== 'UTC') {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(d);
  }
  const utc = timeZone === 'UTC';
  const day = utc ? d.getUTCDate() : d.getDate();
  const mon = utc ? d.getUTCMonth() : d.getMonth();
  const yr = utc ? d.getUTCFullYear() : d.getFullYear();
  return `${day} ${MONTHS[mon]} ${yr}`;
}
