import { Badge } from '@/components/ui/badge';

/** Curation values per schema: uncurated | curated | no_benefits. */
export function CurationBadge({ status }: { status: string }) {
  if (status === 'curated') return <Badge variant="success" className="leading-none">Curated</Badge>;
  if (status === 'no_benefits') return <Badge variant="secondary" className="leading-none">No benefits</Badge>;
  return <Badge variant="warning" className="leading-none">Unverified</Badge>;
}
