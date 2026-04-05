import { expect, test } from '@playwright/test';

import { installChatFetchMocks, type MockChatStreamResponse } from './chat-mocks';

const RICH_FORMATTING_CHAT_STREAM: MockChatStreamResponse = {
  events: [
    {
      event: {
        type: 'tool_start',
        toolCallId: 'tool-1',
        name: 'search_games',
        arguments: {
          limit: 2,
          query: 'games like Hades',
        },
      },
    },
    {
      delayMs: 250,
      event: {
        type: 'tool_result',
        toolCallId: 'tool-1',
        name: 'search_games',
        arguments: {
          limit: 2,
          query: 'games like Hades',
        },
        result: {
          results: [
            {
              appid: 367520,
              name: 'Hollow Knight',
              publisherId: 1,
              publisherName: 'Team Cherry',
              developerId: 1,
              developerName: 'Team Cherry',
            },
            {
              appid: 588650,
              name: 'Dead Cells',
              publisherId: 2,
              publisherName: 'Motion Twin',
              developerId: 2,
              developerName: 'Motion Twin',
            },
          ],
          success: true,
          sufficient_to_answer: true,
          total_found: 2,
        },
        timing: {
          executionMs: 42,
        },
      },
    },
    {
      delayMs: 120,
      event: {
        type: 'text_delta',
        delta: [
          '## Strong matches',
          '',
          'I would start with [Hollow Knight](game:367520), [Team Cherry](/publishers/1), and [Team Cherry](/developers/1).',
          '',
          '| Game | Platforms | Publisher | Developer |',
          '| --- | --- | --- | --- |',
          '| [Hollow Knight](game:367520) | Windows, Linux | [Team Cherry](/publishers/1) | [Team Cherry](/developers/1) |',
          '| [Dead Cells](game:588650) | Windows, macOS, Linux | [Motion Twin](/publishers/2) | [Motion Twin](/developers/2) |',
          '',
          'These are the cleanest editorial matches for the query.',
        ].join('\n'),
      },
    },
    {
      delayMs: 80,
      event: {
        type: 'message_end',
        timing: {
          llmMs: 210,
          toolsMs: 42,
          totalMs: 370,
        },
        debug: {
          iterations: 2,
          lastIterationHadText: true,
          textDeltaCount: 1,
          toolCallCount: 1,
          totalChars: 66,
        },
        sessionContext: null,
      },
    },
  ],
};

const DEBUG_VISIBLE_CHAT_STREAM: MockChatStreamResponse = {
  events: [
    {
      event: {
        type: 'tool_start',
        toolCallId: 'tool-1',
        name: 'query_analytics',
        arguments: {
          cube: 'Apps',
        },
      },
    },
    {
      delayMs: 120,
      event: {
        type: 'tool_result',
        toolCallId: 'tool-1',
        name: 'query_analytics',
        arguments: {
          cube: 'Apps',
        },
        result: {
          success: true,
          rowCount: 1,
          debug: {
            executedSql: 'select * from apps limit 1',
          },
        },
        timing: {
          executionMs: 24,
        },
      },
    },
    {
      delayMs: 100,
      event: {
        type: 'text_delta',
        delta: 'The answer is intentionally concise for this debug check.',
      },
    },
    {
      delayMs: 80,
      event: {
        type: 'message_end',
        timing: {
          llmMs: 180,
          toolsMs: 24,
          totalMs: 330,
        },
        debug: {
          iterations: 1,
          lastIterationHadText: true,
          textDeltaCount: 1,
          toolCallCount: 1,
          totalChars: 58,
        },
        tigerPrimary: {
          enabled: true,
          route: 'primary_success',
          matchedIntent: 'news_search',
        },
        sessionContext: null,
      },
    },
  ],
};

const DEBUG_HIDDEN_CHAT_STREAM: MockChatStreamResponse = {
  events: [
    {
      event: {
        type: 'text_delta',
        delta: 'Plain response without debug metadata.',
      },
    },
    {
      delayMs: 60,
      event: {
        type: 'message_end',
        timing: {
          llmMs: 95,
          toolsMs: 0,
          totalMs: 110,
        },
        sessionContext: null,
      },
    },
  ],
};

const ERROR_CHAT_STREAM: MockChatStreamResponse = {
  events: [
    {
      delayMs: 120,
      event: {
        type: 'error',
        message: 'Synthetic stream failure',
      },
    },
  ],
};

test('chat renders linked entities and analytical tables in assistant responses', async ({ page }) => {
  await installChatFetchMocks(page, {
    chatResponses: [RICH_FORMATTING_CHAT_STREAM],
  });

  await page.goto('/chat');

  const input = page.getByTestId('chat-input');
  const sendButton = page.getByTestId('chat-send');

  await input.fill('games like Hades');
  await sendButton.click();

  await expect(page.getByTestId('chat-message-user').last()).toContainText('games like Hades');
  await expect(page.getByTestId('chat-pending-tools')).toBeVisible();
  await expect(page.getByTestId('chat-pending-tools')).toBeHidden();
  const assistantContent = page.getByTestId('chat-message-assistant-content').last();
  await expect(assistantContent).toContainText('Strong matches');
  await expect(assistantContent.locator('table')).toHaveCount(1);
  await expect(assistantContent.locator('table thead')).toBeVisible();
  await expect(assistantContent.locator('table')).toContainText('Game');
  await expect(assistantContent.locator('table')).toContainText('Platforms');
  await expect(assistantContent.locator('table')).toContainText('Publisher');
  await expect(assistantContent.locator('table')).toContainText('Developer');
  await expect(assistantContent.locator('a[href="/apps/367520"]')).toHaveCount(2);
  await expect(assistantContent.locator('a[href="/publishers/1"]')).toHaveCount(2);
  await expect(assistantContent.locator('a[href="/developers/1"]')).toHaveCount(2);
  await expect(assistantContent.locator('a[href="/apps/588650"]')).toHaveCount(1);
  await expect(assistantContent.locator('a[href="/publishers/2"]')).toHaveCount(1);
  await expect(assistantContent.locator('a[href="/developers/2"]')).toHaveCount(1);
  await expect(assistantContent.getByTitle('Windows')).toHaveCount(2);
  await expect(assistantContent.getByTitle('macOS')).toHaveCount(1);
  await expect(assistantContent.getByTitle('Linux')).toHaveCount(2);

  await expect(input).toBeEnabled();
  await input.fill('show me more');
  await expect(sendButton).toBeEnabled();
});

test('chat reflects debug surface visibility from the streamed payload', async ({ page }) => {
  await installChatFetchMocks(page, {
    chatResponses: [DEBUG_VISIBLE_CHAT_STREAM, DEBUG_HIDDEN_CHAT_STREAM],
  });

  await page.goto('/chat');

  const input = page.getByTestId('chat-input');
  const sendButton = page.getByTestId('chat-send');

  await input.fill('show me the debug surface');
  await sendButton.click();

  const assistantContent = page.getByTestId('chat-message-assistant').last();
  await expect(assistantContent).toContainText('Stream Debug Info');
  await expect(assistantContent).toContainText('System primary');
  await expect(assistantContent).toContainText('News Search');
  await expect(assistantContent).toContainText('Query details');
  await expect(assistantContent).toContainText('1 query');

  await assistantContent.getByRole('button', { name: /query details/i }).click();
  await expect(assistantContent).toContainText('Debug Info');
  await assistantContent.getByText('Debug Info', { exact: true }).click();
  await expect(
    assistantContent.locator('pre').filter({ hasText: 'select * from apps limit 1' })
  ).toContainText('select * from apps limit 1');

  await input.fill('show me the hidden version');
  await sendButton.click();

  const hiddenAssistant = page.getByTestId('chat-message-assistant').last();
  await expect(hiddenAssistant).not.toContainText('Stream Debug Info');
  await expect(hiddenAssistant).not.toContainText('System primary');
  await expect(hiddenAssistant).not.toContainText('Debug Info');
});

test('chat renders streamed errors without getting stuck', async ({ page }) => {
  await installChatFetchMocks(page, {
    chatResponses: [ERROR_CHAT_STREAM],
  });

  await page.goto('/chat');

  const input = page.getByTestId('chat-input');
  const sendButton = page.getByTestId('chat-send');

  await input.fill('games like Hades');
  await sendButton.click();

  await expect(page.getByTestId('chat-error-banner')).toContainText('Synthetic stream failure');
  await expect(page.getByTestId('chat-message-assistant').last()).toContainText(
    'An error occurred.'
  );
  await expect(page.getByTestId('chat-pending-tools')).toBeHidden();
  await expect(input).toBeEnabled();
});
