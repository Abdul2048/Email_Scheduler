import type { SlackStatus } from '../types/api';
import { apiFetch } from './client';

export const SLACK_CONNECT_URL = '/api/integrations/slack/connect';

export const getSlackStatus = () => apiFetch<SlackStatus>('/integrations/slack');

export const sendSlackTest = () => apiFetch<void>('/integrations/slack/test', { method: 'POST' });

export const disconnectSlack = () => apiFetch<void>('/integrations/slack', { method: 'DELETE' });
