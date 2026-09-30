import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'outline' | 'soft' | 'ghost';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover disabled:bg-brand/50',
  outline: 'border border-brand text-brand bg-white hover:bg-brand-soft disabled:opacity-50',
  soft: 'bg-brand-soft text-ink hover:bg-brand-border/60 disabled:opacity-50',
  ghost: 'text-muted hover:bg-surface hover:text-ink disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-4 text-sm rounded-full',
  md: 'h-9 px-4 text-sm rounded-lg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
