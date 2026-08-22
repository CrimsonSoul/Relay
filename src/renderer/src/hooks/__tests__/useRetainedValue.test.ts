import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRetainedValue } from '../useRetainedValue';

describe('useRetainedValue', () => {
  it('keeps the last non-null value while a closing layer exits', () => {
    const { result, rerender } = renderHook(({ value }) => useRetainedValue(value), {
      initialProps: { value: { id: 'target-1' } as { id: string } | null },
    });

    rerender({ value: null });

    expect(result.current).toEqual({ id: 'target-1' });
  });
});
