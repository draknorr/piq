import { expect, test } from '@playwright/test';

import { installChatFetchMocks, type MockChatStreamResponse } from './chat-mocks';

const SUCCESSFUL_CHAT_STREAM: MockChatStreamResponse = {
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
            { appid: 367520, name: 'Hollow Knight' },
            { appid: 588650, name: 'Dead Cells' },
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
        delta: 'Hollow Knight and Dead Cells are two strong follow-ups to Hades.',
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

test('chat streams a successful response through the UI', async ({ page }) => {
  await installChatFetchMocks(page, {
    chatResponses: [SUCCESSFUL_CHAT_STREAM],
  });

  await page.goto('/chat');

  const input = page.getByTestId('chat-input');
  const sendButton = page.getByTestId('chat-send');

  await input.fill('games like Hades');
  await sendButton.click();

  await expect(page.getByTestId('chat-message-user').last()).toContainText('games like Hades');
  await expect(page.getByTestId('chat-pending-tools')).toBeVisible();
  await expect(page.getByTestId('chat-pending-tools')).toBeHidden();
  await expect(page.getByTestId('chat-message-assistant').last()).toContainText(
    'Hollow Knight and Dead Cells are two strong follow-ups to Hades.'
  );

  await expect(input).toBeEnabled();
  await input.fill('show me more');
  await expect(sendButton).toBeEnabled();
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
