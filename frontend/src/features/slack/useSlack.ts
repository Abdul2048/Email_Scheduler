import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { disconnectSlack, getSlackStatus, sendSlackTest } from '../../api/slack';

const SLACK_KEY = ['slack'] as const;

export function useSlackStatus() {
  return useQuery({ queryKey: SLACK_KEY, queryFn: getSlackStatus, staleTime: 60_000 });
}

export function useSlackTest() {
  return useMutation({
    mutationFn: sendSlackTest,
    onSuccess: () => toast.success('Test message sent to Slack'),
    onError: (err) => toast.error('Slack test failed', { description: err.message }),
  });
}

export function useSlackDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectSlack,
    onSuccess: () => {
      toast.success('Slack disconnected');
      void queryClient.invalidateQueries({ queryKey: SLACK_KEY });
    },
    onError: (err) => toast.error("Couldn't disconnect Slack", { description: err.message }),
  });
}

const RESULTS: Record<string, [kind: 'success' | 'error' | 'info', message: string]> = {
  connected: ['success', 'Slack connected. Rate-limit alerts will post to your channel.'],
  cancelled: ['info', 'Slack connection cancelled.'],
  invalid_state: ['error', 'The Slack connection expired. Please try again.'],
  error: ['error', "Couldn't connect Slack. Please try again."],
};

/** Shows the outcome of the Slack OAuth round trip (?slack=...) once, then removes it from the URL. */
export function useSlackResultToast() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const result = params.get('slack');

  useEffect(() => {
    if (!result) return;
    const [kind, message] = RESULTS[result] ?? RESULTS.error;
    toast[kind](message, { id: 'slack-result' });
    void queryClient.invalidateQueries({ queryKey: SLACK_KEY });
    setParams(
      (p) => {
        p.delete('slack');
        return p;
      },
      { replace: true },
    );
  }, [result, setParams, queryClient]);
}
