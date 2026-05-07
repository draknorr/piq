import { ConfigurationRequired } from '@/components/ConfigurationRequired';

export function TigerConfigRequired() {
  return (
    <ConfigurationRequired
      message="Required data source configuration is missing."
      envVars={['Server-side data source URL']}
      instruction="Add the configured server-side data source URL to your Vercel project:"
      footer="Then redeploy your application."
    />
  );
}
