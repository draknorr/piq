import { ConfigurationRequired } from '@/components/ConfigurationRequired';

export function TigerConfigRequired() {
  return (
    <ConfigurationRequired
      message="TigerData environment variables are not configured."
      envVars={['TIGER_PRIMARY_URL', 'CHANGE_INTEL_TIGER_URL']}
      instruction="Add one of these server-side variables to your Vercel project:"
      footer="TIGER_PRIMARY_URL is preferred. Then redeploy your application."
    />
  );
}
