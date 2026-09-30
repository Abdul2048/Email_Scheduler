import type { EmailCounts, EmailDetail, EmailItem, ListEmailsParams, Page } from '../types/api';
import { apiFetch } from './client';

export function listEmails({ view, page = 1, q }: ListEmailsParams) {
  const params = new URLSearchParams({ view, page: String(page) });
  if (q) params.set('q', q);
  return apiFetch<Page<EmailItem>>(`/emails?${params}`);
}

export const getEmailCounts = () => apiFetch<EmailCounts>('/emails/counts');

export const getEmail = (id: string) => apiFetch<EmailDetail>(`/emails/${encodeURIComponent(id)}`);
