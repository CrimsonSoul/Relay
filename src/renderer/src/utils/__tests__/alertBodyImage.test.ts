import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_BODY_IMAGE_MAX_WIDTH, prepareAlertBodyImage } from '../alertBodyImage';

describe('prepareAlertBodyImage', () => {
  const drawImage = vi.fn();
  const close = vi.fn();
  let drawn: { width: number; height: number } | null = null;
  const toDataURL = vi.fn(function (this: HTMLCanvasElement, type?: string) {
    drawn = { width: this.width, height: this.height };
    return `data:${type};base64,RU5DT0RFRA==`;
  });

  const stubBitmap = (width: number, height: number) =>
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width, height, close })),
    );

  beforeEach(() => {
    drawn = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    drawImage.mockClear();
    close.mockClear();
    toDataURL.mockClear();
  });

  it('scales a wide screenshot to the alert body width and keeps PNG', async () => {
    stubBitmap(2064, 1000);
    const file = new File([new Uint8Array([1])], 'screen.png', { type: 'image/png' });

    await expect(prepareAlertBodyImage(file)).resolves.toBe('data:image/png;base64,RU5DT0RFRA==');

    expect(drawn).toEqual({ width: ALERT_BODY_IMAGE_MAX_WIDTH, height: 250 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 516, 250);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('re-encodes photos as JPEG like Insert Image, without enlarging small ones', async () => {
    stubBitmap(300, 200);
    const file = new File([new Uint8Array([1])], 'photo.webp', { type: 'image/webp' });

    await prepareAlertBodyImage(file);

    expect(drawn).toEqual({ width: 300, height: 200 });
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
  });

  it('rejects an image the browser cannot decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed');
      }),
    );
    const file = new File([new Uint8Array([1])], 'broken.png', { type: 'image/png' });

    await expect(prepareAlertBodyImage(file)).rejects.toThrow('decode failed');
  });
});
