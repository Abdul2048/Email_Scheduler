// Mirrors docs/API.md. Times are ISO-8601 UTC strings.

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface ApiErrorBody {
  error: { message: string };
}

export interface CreateCampaignRequest {
  subject: string;
  body: string;
  leads: string[];
  startAt: string;
  delayBetweenEmailsSec: number;
  hourlyLimit: number;
}

export interface CreateCampaignResponse {
  id: string;
  totalCount: number;
  invalidCount: number;
  duplicateCount: number;
}

export type EmailStatus = 'SCHEDULED' | 'DEFERRED' | 'SENDING' | 'SENT' | 'FAILED';

export type EmailView = 'scheduled' | 'sent';

export interface EmailItem {
  id: string;
  toEmail: string;
  subject: string;
  bodyPreview: string;
  senderEmail: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  error: string | null;
}

export interface EmailDetail extends EmailItem {
  body: string;
}

export interface EmailCounts {
  scheduled: number;
  sent: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListEmailsParams {
  view: EmailView;
  page?: number;
  q?: string;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
}
