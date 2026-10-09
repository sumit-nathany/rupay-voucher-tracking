import { Card, CardContent } from '@/components/ui/card';

export function ErrorPanel({ message }: { message: string }) {
  return (
    <Card role="alert" className="border-destructive/40">
      <CardContent className="p-4 sm:p-6">
        <p className="font-medium text-destructive">Something went wrong</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <p className="mt-2 text-sm text-muted-foreground">Reload the page to try again.</p>
      </CardContent>
    </Card>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
        ))}
      </div>
      <div className="skeleton-shimmer h-44 rounded-xl" />
      <div className="skeleton-shimmer h-44 rounded-xl" />
    </div>
  );
}
