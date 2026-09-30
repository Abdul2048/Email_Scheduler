import { Client } from '@elastic/elasticsearch';
import { config } from '../config';

export const elastic = new Client({ node: config.elasticsearchUrl, requestTimeout: 5000, maxRetries: 1 });
