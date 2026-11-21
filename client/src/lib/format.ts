/** Number formatting for prices, percentages and big dollar amounts. Pure. */

const priceFormats = new Map<number, Intl.NumberFormat>();

/** "1,234.56" with a fixed number of decimals (config.market.priceDecimals). */
export function formatPrice(price: number, decimals: number): string {
  let format = priceFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    priceFormats.set(decimals, format);
  }
  return format.format(price);
}

/** Fraction -> "+1.23%" / "-0.40%" / "0.00%". Two decimals below 100%, one above. */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  const text = Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 1 : 2);
  if (Number(text) === 0) return `${text}%`;
  return `${pct > 0 ? '+' : '-'}${text}%`;
}

/** 'up' | 'down' | 'flat' for a change that is displayed with formatPercent (so "0.00%" is flat). */
export function changeDirection(fraction: number): 'up' | 'down' | 'flat' {
  const shown = formatPercent(fraction);
  return shown.startsWith('+') ? 'up' : shown.startsWith('-') ? 'down' : 'flat';
}

const MONEY_UNITS: readonly [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/** "$123.4B", "$5.0B", "$850.0M": three significant-ish digits with a unit. */
export function formatMoneyShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  for (const [size, unit] of MONEY_UNITS) {
    if (abs >= size) return `${sign}$${(abs / size).toFixed(1)}${unit}`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

const wholeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "$10,234,567" (whole dollars). signed = always show + or - (for P&L). */
export function formatMoney(amount: number, signed = false): string {
  const rounded = Math.round(amount);
  const text = `$${wholeFormat.format(Math.abs(rounded))}`;
  if (rounded === 0) return text;
  if (rounded < 0) return `-${text}`;
  return signed ? `+${text}` : text;
}

/** "1,000" / "-250" share counts. */
export function formatShares(qty: number): string {
  return wholeFormat.format(qty);
}
