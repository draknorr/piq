import { loadYoutubeConfig } from '../config.js';
import { runPreviewMirror } from '../jobs.js';

await runPreviewMirror(loadYoutubeConfig());
