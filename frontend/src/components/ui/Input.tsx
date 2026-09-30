import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const field =
  'w-full rounded-lg bg-surface px-3.5 text-sm text-ink placeholder:text-muted outline-none ' +
  'focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, 'h-10', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'resize-none py-3', className)} {...rest} />;
}
