import { loadYoutubeConfig } from '../config.js';
import { runSeedRouting } from '../jobs.js';

await runSeedRouting(loadYoutubeConfig());
