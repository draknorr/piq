import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let youtubeEnvLoaded = false;

export function loadYoutubeEnvFiles(): void {
  if (youtubeEnvLoaded) {
    return;
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = path.resolve(packageRoot, '..', '..');
  const envFiles = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.tiger.local'),
    path.join(repoRoot, '.env.youtube.local'),
    path.join(packageRoot, '.env.local'),
  ];

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue;
    }

    const text = readFileSync(envFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }

  youtubeEnvLoaded = true;
}
