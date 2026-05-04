interface ConfigurationRequiredProps {
  message?: string;
  envVars?: string[];
  instruction?: string;
  footer?: string;
}

const DEFAULT_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

export function ConfigurationRequired({
  message = 'Supabase environment variables are not configured.',
  envVars = DEFAULT_ENV_VARS,
  instruction = 'Add these to your Vercel project:',
  footer = 'Then redeploy your application.',
}: ConfigurationRequiredProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-lg border border-yellow-900/50 bg-yellow-950/20 p-8 text-center">
        <svg
          className="mx-auto h-12 w-12 text-yellow-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <h2 className="mt-4 text-xl font-semibold text-white">
          Configuration Required
        </h2>
        <p className="mt-2 text-gray-400">
          {message}
        </p>
        <div className="mt-4 rounded-lg bg-gray-900 p-4 text-left">
          <p className="text-sm font-medium text-gray-300">
            {instruction}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-gray-400">
            {envVars.map((envVar) => (
              <li key={envVar}>
                <code className="text-yellow-400">{envVar}</code>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          {footer}
        </p>
      </div>
    </div>
  );
}
