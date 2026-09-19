import { describe, expect, it, vi } from 'vitest';
import { SdpAttachmentMutationSchema } from '@shared/sdpAttachments';
import { attachmentBody, attachmentDownloadUrl, downloadAttachment } from './SdpAttachments';
import { SdpProvider } from './SdpProvider';
import { submitMutation } from './SdpMutations';
describe('SDP attachment boundary', () => {
  it('uses the documented multipart upload without treating file text as markup', async () => {
    const mutation = SdpAttachmentMutationSchema.parse({
      kind: 'attachment',
      id: '123',
      name: 'test.txt',
      contentType: 'text/plain',
      data: Buffer.from('<script>test</script>').toString('base64'),
    });
    const body = attachmentBody(mutation);
    expect(body.get('addtoattachment')).toBe('true');
    expect(await (body.get('filename') as File).text()).toBe('<script>test</script>');
    const provider = new SdpProvider();
    const json = vi
      .spyOn(provider, 'json')
      .mockResolvedValue({ response_status: { status_code: 2000 } });
    await submitMutation(provider, 'token', new AbortController().signal, mutation);
    expect(json.mock.calls[0]?.[0]).toContain('/requests/123/_uploads');
    expect(json.mock.calls[0]?.[2]?.body).toBeInstanceOf(FormData);
    expect(json.mock.calls[0]?.[2]?.headers).not.toHaveProperty('Content-Type');
  });
  it('rejects path-like filenames, malformed bytes and cross-ticket or external download paths', () => {
    const value = {
      kind: 'attachment',
      id: '123',
      name: 'test.txt',
      contentType: 'text/plain',
      data: 'dGVzdA==',
    };
    for (const name of ['../test', 'folder\\test', 'test\n.txt'])
      expect(SdpAttachmentMutationSchema.safeParse({ ...value, name }).success).toBe(false);
    expect(() => attachmentBody({ ...value, kind: 'attachment', data: '' })).toThrow();
    expect(() => attachmentBody({ ...value, kind: 'attachment', data: 'a' })).toThrow();
    expect(attachmentDownloadUrl('123', '/requests/123/_uploads/4')).toBe(
      'https://support.campingworld.com/app/itdesk/api/v3/requests/123/_uploads/4',
    );
    for (const url of [
      'https://evil.test/requests/123/_uploads/4',
      '/requests/124/_uploads/4',
      '/requests/123/_uploads/4?token=anything',
      'file:///tmp/private',
      '/requests/123/_uploads/../secrets',
    ])
      expect(() => attachmentDownloadUrl('123', url)).toThrow();
  });
  it('rechecks the authorized ticket and accepts only its listed attachment', async () => {
    const provider = new SdpProvider();
    vi.spyOn(provider, 'json').mockResolvedValue({
      request: {
        id: '123',
        attachments: [
          {
            id: '4',
            name: 'test.txt',
            size: 4,
            content_type: 'text/plain',
            content_url: '/requests/123/_uploads/4',
          },
        ],
      },
    });
    const binary = vi.spyOn(provider, 'binary').mockResolvedValue(Buffer.from('test'));
    const signal = new AbortController().signal;
    expect(await downloadAttachment(provider, 'token', signal, '123', '4')).toEqual({
      name: 'test.txt',
      contentType: 'text/plain',
      data: 'dGVzdA==',
    });
    await expect(downloadAttachment(provider, 'token', signal, '123', '5')).rejects.toThrow();
    expect(binary).toHaveBeenCalledTimes(1);
  });
  it('bounds streaming downloads and refuses redirect responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('redirect', { status: 302, headers: { Location: 'https://evil.test' } }),
      );
    const provider = new SdpProvider(fetchImpl);
    await expect(
      provider.binary('https://support.campingworld.com', new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchImpl.mock.calls[0]?.[1].redirect).toBe('error');
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array(10 * 1024 * 1024 + 1)));
    await expect(
      provider.binary('https://support.campingworld.com', new AbortController().signal),
    ).rejects.toThrow();
  });
});
