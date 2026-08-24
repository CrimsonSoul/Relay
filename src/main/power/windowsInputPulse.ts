export type WindowsInputEvent = {
  type: number;
  u: {
    ki: {
      wVk: number;
      wScan: number;
      dwFlags: number;
      time: number;
      dwExtraInfo: number;
    };
  };
};

export type SendInputFunction = (
  count: number,
  inputs: WindowsInputEvent[],
  inputSize: number,
) => number;

export type WindowsKoffiApi = {
  struct: (name: string, definition: Record<string, unknown>) => unknown;
  union: (name: string, definition: Record<string, unknown>) => unknown;
  load: (library: string) => {
    func: (signature: string) => SendInputFunction;
  };
  sizeof: (type: unknown) => number;
};

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 2;
const VK_F15 = 0x7e;

export function sendF15Pulse(sendInput: SendInputFunction, inputSize: number): boolean {
  const inputs: WindowsInputEvent[] = [
    {
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: VK_F15,
          wScan: 0,
          dwFlags: 0,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    },
    {
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: VK_F15,
          wScan: 0,
          dwFlags: KEYEVENTF_KEYUP,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    },
  ];

  return sendInput(inputs.length, inputs, inputSize) === inputs.length;
}

export function bindWindowsInputPulse(native: WindowsKoffiApi): () => boolean {
  const mouseInput = native.struct('MOUSEINPUT', {
    dx: 'long',
    dy: 'long',
    mouseData: 'uint32_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const keyboardInput = native.struct('KEYBDINPUT', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const hardwareInput = native.struct('HARDWAREINPUT', {
    uMsg: 'uint32_t',
    wParamL: 'uint16_t',
    wParamH: 'uint16_t',
  });
  const inputUnion = native.union('INPUT_UNION', {
    mi: mouseInput,
    ki: keyboardInput,
    hi: hardwareInput,
  });
  const input = native.struct('INPUT', {
    type: 'uint32_t',
    u: inputUnion,
  });
  const user32 = native.load('user32.dll');
  const sendInput = user32.func(
    'unsigned int __stdcall SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)',
  );
  const inputSize = native.sizeof(input);

  return () => sendF15Pulse(sendInput, inputSize);
}

export function createWindowsInputPulse(): () => boolean {
  return bindWindowsInputPulse(koffi as unknown as WindowsKoffiApi);
}
import koffi from 'koffi';
