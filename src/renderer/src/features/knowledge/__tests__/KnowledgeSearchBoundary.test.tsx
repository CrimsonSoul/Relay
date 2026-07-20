import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSearchBoundary } from '../KnowledgeSearchBoundary';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock('../../../utils/logger', () => ({
  loggers: { ui: { error: logError } },
}));

function BrokenPassageResult(): never {
  throw new TypeError('secret query and excerpt');
}

describe('KnowledgeSearchBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('renders only the supplied local fallback and logs no search content', () => {
    render(
      <KnowledgeSearchBoundary fallback={<p>Local title match</p>}>
        <BrokenPassageResult />
      </KnowledgeSearchBoundary>,
    );

    expect(screen.getByText('Local title match')).toBeInTheDocument();
    expect(screen.queryByText('secret query and excerpt')).not.toBeInTheDocument();
    expect(logError).toHaveBeenCalledWith('Enhanced Wiki search rendering failed', {
      errorClass: 'TypeError',
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain('secret query and excerpt');
  });

  it('recovers when a new request generation remounts the boundary', () => {
    const { rerender } = render(
      <KnowledgeSearchBoundary key="generation-1" fallback={<p>Local title match</p>}>
        <BrokenPassageResult />
      </KnowledgeSearchBoundary>,
    );
    expect(screen.getByText('Local title match')).toBeInTheDocument();

    rerender(
      <KnowledgeSearchBoundary key="generation-2" fallback={<p>Local title match</p>}>
        <p>Healthy passage result</p>
      </KnowledgeSearchBoundary>,
    );

    expect(screen.getByText('Healthy passage result')).toBeInTheDocument();
    expect(screen.queryByText('Local title match')).not.toBeInTheDocument();
  });
});
