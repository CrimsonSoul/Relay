import { describe, expect, it } from 'vitest';
import { bindWindowsInputPulse, sendF15Pulse } from './windowsInputPulse';

describe('sendF15Pulse', () => {
  it('inserts an F15 press and release into the Windows input stream', () => {
    let received: unknown[] = [];
    const result = sendF15Pulse((count, inputs, inputSize) => {
      expect(count).toBe(2);
      expect(inputSize).toBe(40);
      received = inputs;
      return 2;
    }, 40);

    expect(result).toBe(true);
    expect(received).toEqual([
      {
        type: 1,
        u: { ki: { wVk: 0x7e, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } },
      },
      {
        type: 1,
        u: { ki: { wVk: 0x7e, wScan: 0, dwFlags: 2, time: 0, dwExtraInfo: 0 } },
      },
    ]);
  });

  it('binds SendInput from the Windows system library with the native INPUT layout', () => {
    const definitions = new Map<string, Record<string, unknown>>();
    let sentInputs: unknown[] = [];
    const pulse = bindWindowsInputPulse({
      struct: (name, definition) => {
        definitions.set(name, definition);
        return { name };
      },
      union: (name, definition) => {
        definitions.set(name, definition);
        return { name };
      },
      load: (library) => {
        expect(library).toBe('user32.dll');
        return {
          func: (signature) => {
            expect(signature).toBe(
              'unsigned int __stdcall SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)',
            );
            return (_count, inputs) => {
              sentInputs = inputs;
              return 2;
            };
          },
        };
      },
      sizeof: (type) => {
        expect(type).toEqual({ name: 'INPUT' });
        return 40;
      },
    });

    expect(pulse()).toBe(true);
    expect(sentInputs).toHaveLength(2);
    expect(definitions.get('KEYBDINPUT')).toEqual({
      wVk: 'uint16_t',
      wScan: 'uint16_t',
      dwFlags: 'uint32_t',
      time: 'uint32_t',
      dwExtraInfo: 'uintptr_t',
    });
    expect(definitions.get('INPUT')).toEqual({
      type: 'uint32_t',
      u: { name: 'INPUT_UNION' },
    });
  });
});
