import type { Metadata } from 'next';
import { ChatContainer } from '@/components/chat';

export const metadata: Metadata = {
  title: 'AI Chat',
};

export const dynamic = 'force-dynamic';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: initialQuery } = await searchParams;
  const promptSeed = crypto.randomUUID();

  return (
    <div className="h-full flex flex-col">
      <ChatContainer initialQuery={initialQuery} promptSeed={promptSeed} />
    </div>
  );
}
