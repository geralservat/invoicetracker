// Pure business logic — no DOM, no network. Tested with node (see README).
// Mirrors Android PaymentRepository.recalculateInvoice + IdGenerator.

export const CONSIGNATION_TERMS_DAYS = -1;
export const PAYMENT_TERM_OPTIONS = [7, 15, 30, CONSIGNATION_TERMS_DAYS];

export function isConsignation(termsDays) {
  return termsDays === CONSIGNATION_TERMS_DAYS;
}

export function paymentTermsLabel(days) {
  return isConsignation(days) ? "Consignation" : `${days} days`;
}

export function toISODate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISODate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).slice(0, 10));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function monthKeyOf(dateStr) {
  return String(dateStr).slice(0, 7); // yyyy-MM
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/**
 * Recalculate invoice status. Only CLEARED payments count toward amountPaid
 * (caller sums them). Consignation never goes overdue.
 * Returns { amountPaid, balance, status, daysOverdue }.
 */
export function recalculateInvoice({ invoiceAmount, clearedTotal, dueDateStr, termsDays, today = new Date() }) {
  const amountPaid = clearedTotal;
  const balance = Math.max(0, round2(invoiceAmount - amountPaid));
  const due = parseISODate(dueDateStr) ?? today;
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  let status = "UNPAID";
  let daysOverdue = 0;
  if (balance <= 0) {
    status = "PAID";
  } else if (!isConsignation(termsDays) && startToday > startDue) {
    status = "OVERDUE";
    daysOverdue = Math.round((startToday - startDue) / 86400000);
  } else if (amountPaid > 0) {
    status = "PARTIALLY_PAID";
  }
  return { amountPaid: round2(amountPaid), balance, status, daysOverdue };
}

export function dueDateFor(invoiceDateStr, termsDays) {
  const base = parseISODate(invoiceDateStr) ?? new Date();
  if (isConsignation(termsDays)) return toISODate(base);
  const d = new Date(base);
  d.setDate(d.getDate() + termsDays);
  return toISODate(d);
}

/** Next sequential id: ["PAY0001","PAY0002"] + "PAY" -> "PAY0003". */
export function nextId(prefix, existingIds) {
  let max = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const n = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function clearedInMonth(payments, monthKey) {
  return payments.filter(
    (p) => p.payment_status === "CLEARED" && monthKeyOf(p.payment_date) === monthKey
  );
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
