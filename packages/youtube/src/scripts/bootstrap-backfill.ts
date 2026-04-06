import { loadYoutubeConfig } from '../config.js';
import { runBootstrapBackfill } from '../jobs.js';

await runBootstrapBackfill(loadYoutubeConfig());
