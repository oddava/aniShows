/** "1 result", "248 results", "2,000+ results" (the API stops counting at a cap). */
export function formatResultCount(count, capped = false) {
  const number = count.toLocaleString('en-US');
  if (capped) return `${number}+ results`;
  return count === 1 ? '1 result' : `${number} results`;
}
