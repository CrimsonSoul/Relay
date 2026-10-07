import { expect, it } from 'vitest';
import { conversationState } from './sdpQueueIndicators';

const row = {
  id: '1',
  number: '1',
  subject: 'Example',
  status: 'Open',
  priority: 'Low',
  group: 'NOC' as const,
  technician: 'Example technician',
  createdAt: 1000,
  dueAt: null,
};

it('maps SDP conversation status to its list-view envelope', () => {
  expect(conversationState(row)).toBeUndefined();
  expect(conversationState({ ...row, notificationStatus: null })?.tone).toBe('none');
  expect(conversationState({ ...row, notificationStatus: 'TECH_REPLY' })?.tone).toBe('technician');
  expect(conversationState({ ...row, notificationStatus: 'FORWARD' })?.tone).toBe('forwarded');
  expect(conversationState({ ...row, notificationStatus: 'REQ_REPLY' })).toEqual({
    tone: 'requester',
    label: 'Requester replied',
  });
  expect(
    conversationState({ ...row, notificationStatus: 'TECH_REPLY', unrepliedCount: 1 }),
  ).toEqual({ tone: 'requester', label: 'Requester replied', waiting: 1 });
  expect(conversationState({ ...row, notificationStatus: 'SYSTEM_NOTIFY' })).toEqual({
    tone: 'other',
    label: 'System notify',
  });
});
