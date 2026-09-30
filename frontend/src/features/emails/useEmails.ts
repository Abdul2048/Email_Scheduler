import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getEmail, getEmailCounts, listEmails } from '../../api/emails';
import type { ListEmailsParams } from '../../types/api';

/** Lists and counts refresh on their own so sends and deferrals show up without a reload. */
const POLL_MS = 5000;

export const emailKeys = {
  all: ['emails'] as const,
  list: (params: ListEmailsParams) => ['emails', 'list', params] as const,
  counts: ['emails', 'counts'] as const,
  detail: (id: string) => ['emails', 'detail', id] as const,
};

export function useEmails(params: ListEmailsParams) {
  return useQuery({
    queryKey: emailKeys.list(params),
    queryFn: () => listEmails(params),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });
}

export function useEmailCounts() {
  return useQuery({ queryKey: emailKeys.counts, queryFn: getEmailCounts, refetchInterval: POLL_MS });
}

export function useEmail(id: string) {
  return useQuery({
    queryKey: emailKeys.detail(id),
    queryFn: () => getEmail(id),
    refetchInterval: (query) => (query.state.data?.status === 'SENT' || query.state.data?.status === 'FAILED' ? false : POLL_MS),
  });
}
