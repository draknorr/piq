import { loadYoutubeConfig } from '../config.js';
import { runRefreshSync } from '../jobs.js';

await runRefreshSync(loadYoutubeConfig());
