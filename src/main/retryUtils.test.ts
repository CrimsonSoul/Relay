import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  retryAsync,
  isTransientError,
  isRetryableFileSystemError,
  retryFileOperation,
  retryNetworkOperation,
} from './retryUtils';

describe('retryUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('retryAsync', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      const result = await retryAsync(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockRejectedValueOnce(new Error('EBUSY'))
        .mockResolvedValue('success');

      const result = await retryAsync(operation, { maxAttempts: 3, initialDelayMs: 1 });
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('persistent failure'));
      await expect(
        retryAsync(operation, { maxAttempts: 2, initialDelayMs: 1 })
      ).rejects.toThrow('persistent failure');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry if shouldRetry returns false', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('fatal error'));
      await expect(
        retryAsync(operation, {
          maxAttempts: 3,
          shouldRetry: () => false,
        })
      ).rejects.toThrow('fatal error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      await retryAsync(operation, {
        maxAttempts: 2,
        initialDelayMs: 1,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    });

    it('should apply exponential backoff', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const start = Date.now();
      await retryAsync(operation, {
        maxAttempts: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitter: false,
      });
      const elapsed = Date.now() - start;

      // First retry: 10ms, second retry: 20ms = 30ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });
  });

  describe('isTransientError', () => {
    it('should identify EBUSY as transient', () => {
      const error = new Error('EBUSY: resource busy');
      expect(isTransientError(error)).toBe(true);
    });

    it('should identify EAGAIN as transient', () => {
      const error = new Error('EAGAIN: resource temporarily unavailable');
      expect(isTransientError(error)).toBe(true);
    });

    it('should identify ETIMEDOUT as transient', () => {
      const error = new Error('ETIMEDOUT: connection timed out');
      expect(isTransientError(error)).toBe(true);
    });

    it('should not identify non-transient errors', () => {
      const error = new Error('ENOENT: file not found');
      expect(isTransientError(error)).toBe(false);
    });

    it('should handle non-Error objects', () => {
      expect(isTransientError('some string')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe('isRetryableFileSystemError', () => {
    it('should identify EBUSY as retryable', () => {
      const error = Object.assign(new Error('File busy'), { code: 'EBUSY' });
      expect(isRetryableFileSystemError(error)).toBe(true);
    });

    it('should identify EAGAIN as retryable', () => {
      const error = Object.assign(new Error('Try again'), { code: 'EAGAIN' });
      expect(isRetryableFileSystemError(error)).toBe(true);
    });

    it('should identify EACCES as retryable', () => {
      const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
      expect(isRetryableFileSystemError(error)).toBe(true);
    });

    it('should not identify ENOENT as retryable', () => {
      const error = Object.assign(new Error('Not found'), { code: 'ENOENT' });
      expect(isRetryableFileSystemError(error)).toBe(false);
    });

    it('should fall back to isTransientError for errors without code', () => {
      const error = new Error('EBUSY: resource busy');
      expect(isRetryableFileSystemError(error)).toBe(true);
    });
  });

  describe('retryFileOperation', () => {
    it('should retry file operations with appropriate defaults', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
        .mockResolvedValue('success');

      const result = await retryFileOperation(operation, 'testOperation');
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-transient errors', async () => {
      const operation = vi.fn()
        .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await expect(
        retryFileOperation(operation, 'testOperation')
      ).rejects.toThrow('ENOENT');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryNetworkOperation', () => {
    it('should retry network operations with appropriate defaults', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('success');

      const result = await retryNetworkOperation(operation, 'apiCall');
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
        .mockResolvedValue('success');

      const result = await retryNetworkOperation(operation, 'apiCall');
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on various 5xx error codes', async () => {
      const testCases = [
        'HTTP 500 Internal Server Error',
        'HTTP 502 Bad Gateway',
        'HTTP 503 Service Unavailable',
        'HTTP 504 Gateway Timeout',
        'Error 599 Network Connect Timeout Error',
      ];

      for (const errorMessage of testCases) {
        const operation = vi.fn()
          .mockRejectedValueOnce(new Error(errorMessage))
          .mockResolvedValue('success');

        const result = await retryNetworkOperation(operation, 'apiCall');
        expect(result).toBe('success');
      }
    });

    it('should not retry on client errors (4xx)', async () => {
      const operation = vi.fn()
        .mockRejectedValue(new Error('HTTP 404 Not Found'));

      await expect(
        retryNetworkOperation(operation, 'apiCall')
      ).rejects.toThrow('404');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry on errors containing digit 5 in non-status contexts', async () => {
      const operation = vi.fn()
        .mockRejectedValue(new Error('Failed to connect to port 5432'));

      await expect(
        retryNetworkOperation(operation, 'apiCall')
      ).rejects.toThrow('5432');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
