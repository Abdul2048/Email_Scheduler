import { Hash, Unplug } from 'lucide-react';
import { SLACK_CONNECT_URL } from '../../api/slack';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { useSlackDisconnect, useSlackStatus, useSlackTest } from './useSlack';

function SlackLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 54 54" aria-hidden="true" className={className}>
      <path fill="#36C5F0" d="M19.7 0a5.4 5.4 0 1 0 0 10.8h5.4V5.4A5.4 5.4 0 0 0 19.7 0m0 14.4H5.4a5.4 5.4 0 1 0 0 10.8h14.3a5.4 5.4 0 1 0 0-10.8" />
      <path fill="#2EB67D" d="M54 19.8a5.4 5.4 0 1 0-10.8 0v5.4h5.4a5.4 5.4 0 0 0 5.4-5.4m-14.4 0V5.4a5.4 5.4 0 1 0-10.8 0v14.4a5.4 5.4 0 1 0 10.8 0" />
      <path fill="#ECB22E" d="M34.2 54a5.4 5.4 0 1 0 0-10.8h-5.4v5.4a5.4 5.4 0 0 0 5.4 5.4m0-14.4h14.4a5.4 5.4 0 1 0 0-10.8H34.2a5.4 5.4 0 1 0 0 10.8" />
      <path fill="#E01E5A" d="M0 34.2a5.4 5.4 0 1 0 10.8 0v-5.4H5.4A5.4 5.4 0 0 0 0 34.2m14.4 0v14.4a5.4 5.4 0 1 0 10.8 0V34.2a5.4 5.4 0 1 0-10.8 0" />
    </svg>
  );
}

/** Sidebar card: connect Slack for hourly-limit alerts, or show the connected channel. */
export function SlackCard() {
  const { data, isPending, isError } = useSlackStatus();
  const test = useSlackTest();
  const disconnect = useSlackDisconnect();

  let body;
  if (isPending) body = <Spinner className="size-4" />;
  else if (isError) body = <p className="text-xs text-danger">Couldn't load Slack status.</p>;
  else if (!data.configured) body = <p className="text-xs text-muted">Slack isn't configured on the server.</p>;
  else if (!data.connected) {
    body = (
      <>
        <p className="text-xs text-muted">Get a message when a sender hits its hourly limit.</p>
        <a
          href={SLACK_CONNECT_URL}
          className="inline-flex h-7 items-center justify-center rounded-full border border-brand text-xs font-medium text-brand hover:bg-brand-soft"
        >
          Connect Slack
        </a>
      </>
    );
  } else {
    body = (
      <>
        <p className="flex items-center gap-1 truncate text-xs" title={`${data.teamName} · ${data.channelName}`}>
          <Hash className="size-3 shrink-0 text-muted" />
          <span className="truncate">{data.channelName?.replace(/^#/, '')}</span>
          <span className="truncate text-muted">· {data.teamName}</span>
        </p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-7 flex-1 px-2 text-xs" loading={test.isPending} onClick={() => test.mutate()}>
            Send test
          </Button>
          <button
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            aria-label="Disconnect Slack"
            title="Disconnect Slack"
            className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
          >
            {disconnect.isPending ? <Spinner className="size-4" /> : <Unplug className="size-4" />}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line p-2.5">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold">
        <SlackLogo className="size-3.5" />
        Slack alerts
        {data?.connected && <span className="ml-auto size-1.5 rounded-full bg-brand" title="Connected" />}
      </h2>
      {body}
    </section>
  );
}
