import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Notification } from '@server/lib/notifications';
import type { NotificationPayload } from '@server/lib/notifications/agents/agent';
import TelegramAgent from '@server/lib/notifications/agents/telegram';

// The message is MarkdownV2, where "(", ")", "-" and "." must be escaped or
// Telegram rejects the whole message.
describe('Telegram notification fields', () => {
  it('escapes the field names and values', () => {
    const agent = new TelegramAgent();
    const payload = (
      agent as unknown as {
        getNotificationPayload: (
          type: Notification,
          payload: NotificationPayload
        ) => { text?: string; caption?: string };
      }
    ).getNotificationPayload(Notification.MEDIA_APPROVED, {
      event: 'Movie Request Approved',
      subject: 'Runner (2026)',
      notifyAdmin: false,
      notifySystem: true,
      extra: [{ name: 'Version', value: 'Standard (Anime dub-only)' }],
    });
    const text = payload.text ?? payload.caption ?? '';

    assert.ok(
      text.includes('\n*Version:* Standard \\(Anime dub\\-only\\)'),
      text
    );
  });
});
