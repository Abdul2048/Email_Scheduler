import { ChevronDown, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { User } from '../../types/api';
import { useLogout } from '../../features/auth/useMe';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';

export function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${user.name} · ${user.email}`}
        className="flex w-full items-center gap-2.5 rounded-xl bg-surface px-2.5 py-2 text-left hover:bg-line"
      >
        <Avatar name={user.name} src={user.avatarUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user.name}</span>
          <span className="block truncate text-[11px] text-muted">{user.email}</span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-line bg-white p-1 shadow-lg">
          <button
            role="menuitem"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-danger hover:bg-danger-soft"
          >
            {logout.isPending ? <Spinner className="size-4" /> : <LogOut className="size-4" />}
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
