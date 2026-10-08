import { expect, it } from 'vitest';
import { priorityLevel } from './sdpQueueFormat';

it('fills priority bars from SDP’s default names and P numbers, and none for others', () => {
  expect(
    ['Low', 'Medium', 'High', 'Urgent', 'P1 - Critical', 'P3', 'Normal', 'Custom', ''].map(
      priorityLevel,
    ),
  ).toEqual([1, 2, 3, 4, 4, 2, 2, 0, 0]);
});
