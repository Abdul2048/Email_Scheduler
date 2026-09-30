import type { CreateCampaignRequest, CreateCampaignResponse } from '../types/api';
import { apiFetch } from './client';

export const createCampaign = (body: CreateCampaignRequest) =>
  apiFetch<CreateCampaignResponse>('/campaigns', { method: 'POST', body: JSON.stringify(body) });
