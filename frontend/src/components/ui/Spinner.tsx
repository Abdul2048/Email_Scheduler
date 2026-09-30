import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-label="Loading" className={cn('size-5 animate-spin text-muted', className)} />;
}

export function PageSpinner() {
  return (
    <div className="flex h-full min-h-40 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}
