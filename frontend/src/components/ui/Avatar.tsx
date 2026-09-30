import { useState } from 'react';
import { cn } from '../../lib/cn';

interface AvatarProps {
  name: string;
  src?: string | null;
  className?: string;
}

export function Avatar({ name, src, className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const base = cn('size-8 shrink-0 rounded-full', className);

  if (src && !broken) {
    return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn(base, 'object-cover')} />;
  }
  return (
    <span className={cn(base, 'flex items-center justify-center bg-brand font-medium text-white')}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
