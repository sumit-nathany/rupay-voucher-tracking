import type { InstanceListItem } from '@/domain/instance-queries';

/**
 * Short name for the benefit column: the provider (e.g. "Reliance Digital").
 * The portal's offer text repeats the period ("... Offline- Quarterly"), which the
 * period column already shows. Falls back to the offer text when there is no
 * provider, e.g. an unchosen "Any one of 6 offers".
 */
export const benefitLabel = (it: Pick<InstanceListItem, 'benefitProvider' | 'benefitName'>) =>
  it.benefitProvider || it.benefitName;
