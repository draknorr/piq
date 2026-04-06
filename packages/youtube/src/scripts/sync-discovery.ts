import { loadYoutubeConfig } from '../config.js';
import { runDiscoverySync } from '../jobs.js';

await runDiscoverySync(loadYoutubeConfig());
