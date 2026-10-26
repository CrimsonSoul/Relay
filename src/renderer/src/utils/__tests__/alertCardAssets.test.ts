import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAlertIconStrip, renderAlertToneIcon } from '../alertCardAssets';

describe('renderAlertIconStrip', () => {
  const fills: Array<{ style: string; rect: number[] }> = [];
  const drawImage = vi.fn();
  const arc = vi.fn();
  let loadedSrc = '';

  beforeEach(() => {
    fills.length = 0;
    let fillStyle = '';
    const context = {
      set fillStyle(value: string) {
        fillStyle = value;
      },
      get fillStyle() {
        return fillStyle;
      },
      strokeStyle: '',
      lineWidth: 0,
      fillRect: (...rect: number[]) => fills.push({ style: fillStyle, rect }),
      beginPath: vi.fn(),
      arc,
      fill: vi.fn(),
      stroke: vi.fn(),
      drawImage,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,U1RSSVA=',
    );
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
          loadedSrc = value;
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    drawImage.mockClear();
    arc.mockClear();
  });

  it('paints the banner half, the white half, the ringed circle and the severity icon', async () => {
    await expect(renderAlertIconStrip('ISSUE')).resolves.toBe('data:image/png;base64,U1RSSVA=');

    expect(fills).toEqual([
      { style: '#d32f2f', rect: [0, 0, 1272, 56] },
      { style: '#ffffff', rect: [0, 56, 1272, 56] },
    ]);
    expect(arc).toHaveBeenCalledWith(636, 56, 51, 0, Math.PI * 2);
    expect(loadedSrc).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(loadedSrc)).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 606, 26, 60, 60);
  });
});

describe('renderAlertToneIcon', () => {
  const fillStyles: string[] = [];
  const arc = vi.fn();

  beforeEach(() => {
    fillStyles.length = 0;
    let fillStyle = '';
    const context = {
      set fillStyle(value: string) {
        fillStyle = value;
      },
      get fillStyle() {
        return fillStyle;
      },
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      beginPath: vi.fn(),
      arc,
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillRect: vi.fn(),
      fill: () => fillStyles.push(fillStyle),
      stroke: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,VE9ORQ==',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    arc.mockClear();
  });

  it('draws a 20 px tone disc at 2x and returns a PNG data URL', async () => {
    expect(renderAlertToneIcon('success')).toBe('data:image/png;base64,VE9ORQ==');
    expect(arc).toHaveBeenCalledWith(20, 20, 20, 0, Math.PI * 2);
    expect(fillStyles[0]).toBe('#15803D');
  });
});
