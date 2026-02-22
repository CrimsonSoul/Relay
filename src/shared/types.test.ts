import { describe, it, expect } from 'vitest';
import { isNodeError, getErrorMessage } from './types';

describe('types utilities', () => {
  describe('isNodeError', () => {
    it('returns true for objects with a code property', () => {
      const err = { code: 'ENOENT', message: 'No such file' };
      expect(isNodeError(err)).toBe(true);
    });

    it('returns true for Error with code property', () => {
      const err = Object.assign(new Error('Not found'), { code: 'ENOENT' });
      expect(isNodeError(err)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isNodeError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isNodeError(undefined)).toBe(false);
    });

    it('returns false for a plain string', () => {
      expect(isNodeError('ENOENT')).toBe(false);
    });

    it('returns false for object without code property', () => {
      expect(isNodeError({ message: 'error' })).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isNodeError(42)).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('returns message from an Error instance', () => {
      expect(getErrorMessage(new Error('Something broke'))).toBe('Something broke');
    });

    it('returns message from an error-like object with message property', () => {
      expect(getErrorMessage({ message: 'Custom error message' })).toBe('Custom error message');
    });

    it('returns message from an error-like object with code and message', () => {
      expect(getErrorMessage({ code: 'ERR_404', message: 'Not found' })).toBe('Not found');
    });

    it('returns the string itself when passed a string', () => {
      expect(getErrorMessage('Just a string error')).toBe('Just a string error');
    });

    it('returns String(value) for a number', () => {
      expect(getErrorMessage(42)).toBe('42');
    });

    it('returns String(value) for null', () => {
      expect(getErrorMessage(null)).toBe('null');
    });

    it('returns String(value) for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('returns String(value) for an object without message', () => {
      expect(getErrorMessage({ code: 'ERR' })).toBe('[object Object]');
    });

    it('handles Error with empty message', () => {
      expect(getErrorMessage(new Error(''))).toBe('');
    });

    it('handles error-like object with stack but no message', () => {
      const errLike = { stack: 'Error at ...' };
      // isErrorLike returns true (has stack), but error.message is undefined → falls through to string check
      // getErrorMessage will return String(errLike) since message is falsy
      const result = getErrorMessage(errLike);
      expect(typeof result).toBe('string');
    });

    it('returns String for boolean false', () => {
      expect(getErrorMessage(false)).toBe('false');
    });

    it('returns String for boolean true', () => {
      expect(getErrorMessage(true)).toBe('true');
    });
  });
});
