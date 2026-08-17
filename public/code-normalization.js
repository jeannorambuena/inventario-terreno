export function createLookupCodeVariants(value) {
  const exact = String(value ?? '').trim();
  if (!exact) return [];

  const variants = new Set([exact]);
  const municipal = exact.match(/^(\d{2})-(\d{2})-(\d{5})$/);
  if (municipal) {
    const compact = `${municipal[1]}${municipal[2]}${municipal[3]}`;
    variants.add(compact);
    variants.add(compact.padStart(10, '0'));
  } else if (/^\d{9}$/.test(exact)) {
    variants.add(exact.padStart(10, '0'));
    variants.add(`${exact.slice(0, 2)}-${exact.slice(2, 4)}-${exact.slice(4)}`);
  } else if (/^0\d{9}$/.test(exact)) {
    const municipalDigits = exact.slice(1);
    variants.add(municipalDigits);
    variants.add(`${municipalDigits.slice(0, 2)}-${municipalDigits.slice(2, 4)}-${municipalDigits.slice(4)}`);
  }
  return [...variants];
}
