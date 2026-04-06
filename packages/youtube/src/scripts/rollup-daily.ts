import { loadYoutubeConfig } from '../config.js';
import { runDailyRollup } from '../jobs.js';

await runDailyRollup(loadYoutubeConfig());
