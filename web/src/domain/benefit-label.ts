/** Label for benefit filter options and list section headers (`type · provider`). */
export function benefitOptionLabel(
  benefitType: string | null,
  benefitProvider: string | null,
  exactBenefit: string | null,
): string {
  const name = (exactBenefit ?? '').trim();
  const type = (benefitType ?? '').trim();
  const prov = (benefitProvider ?? '').trim() || name;
  return type ? `${type} · ${prov}` : prov || name || 'Benefit';
}
