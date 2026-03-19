import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth-utils';
import { createServerClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui';
import { BarChart3, Coins, MessageSquare, Users } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Usage Analytics | Admin',
};

export const dynamic = 'force-dynamic';

interface UserUsage {
  id: string;
  email: string;
  full_name: string | null;
  credit_balance: number;
  total_credits_used: number;
  total_messages_sent: number;
}

interface UsageStats {
  totalCreditsInSystem: number;
  totalCreditsUsed: number;
  totalMessages: number;
  messagesLast7Days: number;
  creditsUsedLast7Days: number;
}

interface ToolUsage {
  name: string;
  count: number;
}

interface ChatUsageLog {
  user_id: string | null;
  total_credits_charged: number | null;
  tool_names: string[] | null;
  created_at: string;
}

interface UserProfileSummary {
  id: string;
  email: string;
  full_name: string | null;
  credit_balance: number;
}

const CHAT_LOGS_PAGE_SIZE = 1000;

async function fetchAllChatLogs(): Promise<ChatUsageLog[]> {
  const supabase = await createServerClient();
  const logs: ChatUsageLog[] = [];

  for (let from = 0; ; from += CHAT_LOGS_PAGE_SIZE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('chat_query_logs') as any)
      .select('user_id, total_credits_charged, tool_names, created_at')
      .order('created_at', { ascending: false })
      .range(from, from + CHAT_LOGS_PAGE_SIZE - 1) as {
        data: ChatUsageLog[] | null;
        error: { message: string } | null;
      };

    if (error) {
      throw new Error(`Failed to fetch chat usage logs: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    logs.push(...data);

    if (data.length < CHAT_LOGS_PAGE_SIZE) {
      break;
    }
  }

  return logs;
}

async function getUsagePageData(): Promise<{
  stats: UsageStats;
  topUsers: UserUsage[];
  toolUsage: ToolUsage[];
}> {
  const supabase = await createServerClient();

  const [logs, profilesResult] = await Promise.all([
    fetchAllChatLogs(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('user_profiles') as any)
      .select('id, email, full_name, credit_balance') as PromiseLike<{
        data: UserProfileSummary[] | null;
      }>,
  ]);

  const profiles = profilesResult.data ?? [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const toolCounts: Record<string, number> = {};
  const userUsage = new Map<string, { total_credits_used: number; total_messages_sent: number }>();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let totalCreditsUsed = 0;
  let messagesLast7Days = 0;
  let creditsUsedLast7Days = 0;

  for (const log of logs) {
    const creditsCharged = log.total_credits_charged ?? 0;
    totalCreditsUsed += creditsCharged;

    if (new Date(log.created_at).getTime() >= sevenDaysAgo) {
      messagesLast7Days += 1;
      creditsUsedLast7Days += creditsCharged;
    }

    log.tool_names?.forEach((tool) => {
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    });

    if (!log.user_id) {
      continue;
    }

    const existing = userUsage.get(log.user_id) ?? {
      total_credits_used: 0,
      total_messages_sent: 0,
    };

    existing.total_credits_used += creditsCharged;
    existing.total_messages_sent += 1;
    userUsage.set(log.user_id, existing);
  }

  const totalCreditsInSystem = profiles.reduce((sum, profile) => {
    return sum + (profile.credit_balance ?? 0);
  }, 0);

  const topUsers = [...userUsage.entries()]
    .map(([userId, usage]) => {
      const profile = profileMap.get(userId);
      if (!profile) {
        return null;
      }

      return {
        id: userId,
        email: profile.email,
        full_name: profile.full_name,
        credit_balance: profile.credit_balance,
        total_credits_used: usage.total_credits_used,
        total_messages_sent: usage.total_messages_sent,
      };
    })
    .filter((user): user is UserUsage => user !== null)
    .sort((a, b) => {
      if (b.total_credits_used !== a.total_credits_used) {
        return b.total_credits_used - a.total_credits_used;
      }

      return b.total_messages_sent - a.total_messages_sent;
    })
    .slice(0, 10);

  const toolUsage = Object.entries(toolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    stats: {
      totalCreditsInSystem,
      totalCreditsUsed,
      totalMessages: logs.length,
      messagesLast7Days,
      creditsUsedLast7Days,
    },
    topUsers,
    toolUsage,
  };
}

export default async function AdminUsagePage() {
  await requireAdmin();
  const { stats, topUsers, toolUsage } = await getUsagePageData();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-display-sm text-text-primary">Usage Analytics</h1>
        <p className="mt-1 text-body-sm text-text-secondary">
          Credit usage and chat activity metrics
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <Coins className="h-5 w-5 text-accent-green" />
            <div>
              <p className="text-body-sm text-text-secondary">Credits in System</p>
              <p className="text-display-sm text-text-primary">
                {stats.totalCreditsInSystem.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-accent-blue" />
            <div>
              <p className="text-body-sm text-text-secondary">Total Credits Used</p>
              <p className="text-display-sm text-text-primary">
                {stats.totalCreditsUsed.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>

        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-accent-purple" />
            <div>
              <p className="text-body-sm text-text-secondary">Total Messages</p>
              <p className="text-display-sm text-text-primary">
                {stats.totalMessages.toLocaleString()}
              </p>
              <p className="text-caption text-text-muted">All time</p>
            </div>
          </div>
        </Card>

        <Card variant="default" padding="md">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-accent-orange" />
            <div>
              <p className="text-body-sm text-text-secondary">Last 7 Days</p>
              <p className="text-display-sm text-text-primary">
                {stats.messagesLast7Days} msgs
              </p>
              <p className="text-caption text-text-muted">
                {stats.creditsUsedLast7Days.toLocaleString()} credits
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Users */}
        <Card variant="default" padding="none">
          <div className="p-4 border-b border-border-subtle">
            <h2 className="text-subheading text-text-primary">Top Users by Credits Used</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-raised">
                  <th className="px-4 py-2 text-left text-caption text-text-secondary font-medium">
                    User
                  </th>
                  <th className="px-4 py-2 text-right text-caption text-text-secondary font-medium">
                    Credits Used
                  </th>
                  <th className="px-4 py-2 text-right text-caption text-text-secondary font-medium">
                    Messages
                  </th>
                </tr>
              </thead>
              <tbody>
                {topUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border-subtle last:border-0"
                  >
                    <td className="px-4 py-2">
                      <p className="text-body-sm text-text-primary">
                        {user.full_name || user.email}
                      </p>
                      {user.full_name && (
                        <p className="text-caption text-text-muted">{user.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-body-sm text-text-primary">
                        {user.total_credits_used.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-body-sm text-text-secondary">
                        {user.total_messages_sent}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {topUsers.length === 0 && (
            <div className="p-8 text-center text-text-secondary">
              No usage data yet.
            </div>
          )}
        </Card>

        {/* Tool Usage */}
        <Card variant="default" padding="none">
          <div className="p-4 border-b border-border-subtle">
            <h2 className="text-subheading text-text-primary">Tool Usage</h2>
          </div>
          <div className="p-4 space-y-3">
            {toolUsage.map((tool) => {
              const maxCount = toolUsage[0]?.count ?? 1;
              const percentage = (tool.count / maxCount) * 100;

              return (
                <div key={tool.name}>
                  <div className="flex justify-between text-body-sm mb-1">
                    <span className="text-text-primary">{tool.name}</span>
                    <span className="text-text-secondary">{tool.count}</span>
                  </div>
                  <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-blue rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {toolUsage.length === 0 && (
              <div className="text-center text-text-secondary py-4">
                No tool usage data yet.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
