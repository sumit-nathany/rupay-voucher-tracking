import { Badge } from '@/components/ui/badge';

/** Curation values per schema: uncurated | curated | no_benefits. */
export function CurationBadge({ status }: { status: string }) {
  if (status === 'curated') return <Badge variant="success">Curated</Badge>;
  if (status === 'no_benefits') return <Badge variant="secondary">No benefits</Badge>;
  return <Badge variant="warning">Unverified</Badge>;
}
