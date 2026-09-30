import { Clock, ExternalLink, Send, type LucideIcon } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { EmailCounts, User } from '../../types/api';
import { SlackCard } from '../../features/slack/SlackCard';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { UserMenu } from './UserMenu';

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  count?: number;
}

function NavItem({ to, icon: Icon, label, count }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
          isActive ? 'bg-brand-soft font-semibold' : 'text-ink/80 hover:bg-surface',
        )
      }
    >
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs font-normal text-muted">{count.toLocaleString()}</span>}
    </NavLink>
  );
}

export function Sidebar({ user, counts }: { user: User; counts?: EmailCounts }) {
  const navigate = useNavigate();
  return (
    <aside className="flex w-[190px] shrink-0 flex-col gap-3 overflow-y-auto px-3 pt-4 pb-3">
      <div className="px-1.5 font-mono text-[26px] leading-none font-black tracking-tighter">ONB</div>
      <UserMenu user={user} />
      <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/compose')}>
        Compose
      </Button>
      <nav className="mt-2 flex flex-col gap-1">
        <p className="px-2.5 pb-1 text-[10px] font-medium tracking-wide text-muted uppercase">Core</p>
        <NavItem to="/scheduled" icon={Clock} label="Scheduled" count={counts?.scheduled} />
        <NavItem to="/sent" icon={Send} label="Sent" count={counts?.sent} />
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <SlackCard />
        <a
          href="/admin/queues"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-1 text-xs text-muted hover:text-ink"
        >
          <ExternalLink className="size-3.5" />
          Queue dashboard
        </a>
      </div>
    </aside>
  );
}
