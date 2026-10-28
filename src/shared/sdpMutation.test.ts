import { describe, expect, it } from 'vitest';
import { sdpRejectedFields, sdpRejectionMessage } from './sdpMutation';

describe('SDP rejection messages', () => {
  it('reads back the fields a rejection names, with or without trailing context', () => {
    const message = sdpRejectionMessage(['subcategory', 'udf_fields.udf_pick_301']);
    expect(sdpRejectedFields(message)).toEqual(['subcategory', 'udf_fields.udf_pick_301']);
    expect(sdpRejectedFields(`${message} Refresh the queue to see current values.`)).toEqual([
      'subcategory',
      'udf_fields.udf_pick_301',
    ]);
  });
  it('finds no fields in other messages', () => {
    expect(sdpRejectedFields(sdpRejectionMessage([]))).toEqual([]);
    expect(sdpRejectedFields('Change confirmed by SDP.')).toEqual([]);
    expect(sdpRejectedFields(undefined)).toEqual([]);
  });
});
