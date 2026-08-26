import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProofpointProvider } from './proofpointProvider';

const COMMUNITY_URL = 'https://proofpoint.my.site.com/community/s/proofpoint-current-incidents';
const AURA_URL =
  'https://proofpoint.my.site.com/community/s/sfsites/aura?r=1&aura.FlowRuntimeConnect.startFlow=1';

const COMMUNITY_PAGE = [
  '<html>',
  'fwuid%22%3A%22test-fwuid%22',
  'APPLICATION%40markup%3A%2F%2Fsiteforce%3AcommunityApp%22%3A%22test-app-version%22',
  '</html>',
].join('');

function incidentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ArticleNumber: '000026896',
    Title: 'Proofpoint Service Interruption Affecting Multiple Services-14-Aug-2026',
    Community_URL__c:
      'https://proofpoint.my.site.com/community/s/article/Proofpoint-Service-Interruption-Affecting-Multiple-Services-14-Aug-2026',
    ArticleCreatedDate: '2026-08-14T12:53:06.000Z',
    LastPublishedDate: '2026-08-14T14:51:43.000Z',
    FAQ_How_To_Description__c: [
      '<table><tbody>',
      '<tr><td>Summary</td><td>Mail flow and portal access may be unavailable.</td></tr>',
      '</tbody></table>',
      '<table><tbody>',
      '<tr><td>Product</td><td>Status</td></tr>',
      '<tr><td>Proofpoint Essentials</td><td>Currently Impacted</td></tr>',
      '<tr><td>Email Protection</td><td>Currently Impacted</td></tr>',
      '<tr><td>Threat Protection</td><td>Recovered</td></tr>',
      '</tbody></table>',
    ].join(''),
    ...overrides,
  };
}

function auraResponse(tableData: unknown): Record<string, unknown> {
  return {
    actions: [
      {
        state: 'SUCCESS',
        returnValue: {
          response: {
            fields: [{ inputs: [{ name: 'tableData', value: tableData }] }],
          },
          error: null,
        },
      },
    ],
  };
}

function displayTextResponse(label: string): Record<string, unknown> {
  return {
    actions: [
      {
        state: 'SUCCESS',
        returnValue: {
          response: {
            fields: [
              {
                name: 'DisplayText',
                fieldType: 'DISPLAY_TEXT',
                dataType: 'STRING',
                label,
                value: null,
                inputs: null,
                fields: [],
              },
            ],
          },
          error: null,
        },
      },
    ],
  };
}

function mockProofpointResponses(tableData: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(COMMUNITY_PAGE, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(auraResponse(tableData)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Proofpoint current incidents provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps a current enterprise incident and its currently impacted products', async () => {
    mockProofpointResponses([incidentRecord()]);

    await expect(fetchProofpointProvider()).resolves.toEqual([
      {
        id: '000026896',
        provider: 'proofpoint',
        title: 'Proofpoint Service Interruption Affecting Multiple Services-14-Aug-2026',
        description: 'Mail flow and portal access may be unavailable.',
        pubDate: '2026-08-14T14:51:43.000Z',
        link: incidentRecord().Community_URL__c,
        severity: 'error',
        affectedScopes: ['Proofpoint Essentials', 'Email Protection'],
      },
    ]);
  });

  it('treats an authoritative empty current-incidents table as operational', async () => {
    mockProofpointResponses([]);

    await expect(fetchProofpointProvider()).resolves.toEqual([]);
  });

  it('treats Proofpoint’s current no-incidents display as operational', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(COMMUNITY_PAGE, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            displayTextResponse(
              '<p style="text-align: center;"><strong>No current identified incidents</strong></p><p>If you are seeing a service disruption, please open a support case</p>',
            ),
          ),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProofpointProvider()).resolves.toEqual([]);
  });

  it('rejects an unrecognized Proofpoint display instead of assuming operational', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(COMMUNITY_PAGE, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(displayTextResponse('<p>Service state unavailable</p>')), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProofpointProvider()).rejects.toThrow(
      'Invalid Proofpoint current-incidents response',
    );
  });

  it('does not surface a current-incidents row after every product is recovered', async () => {
    mockProofpointResponses([
      incidentRecord({
        FAQ_How_To_Description__c:
          '<table><tr><td>Email Protection</td><td>Recovered</td></tr></table>',
      }),
    ]);

    await expect(fetchProofpointProvider()).resolves.toEqual([]);
  });

  it('uses the public enterprise flow without sending cookies or credentials', async () => {
    const fetchMock = mockProofpointResponses([]);

    await fetchProofpointProvider();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      COMMUNITY_URL,
      expect.objectContaining({
        credentials: 'omit',
        headers: { Accept: 'text/html' },
        redirect: 'error',
      }),
    );
    const [, postInit] = fetchMock.mock.calls[1] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(fetchMock.mock.calls[1]?.[0]).toBe(AURA_URL);
    expect(postInit).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
      }),
    );
    expect(String(postInit.body)).toContain('Incident_Article_Number');
    expect(String(postInit.body)).toContain('test-fwuid');
    expect(String(postInit.body)).toContain('test-app-version');
  });

  it('rejects a malformed flow response instead of reporting operational', async () => {
    mockProofpointResponses({ not: 'an incident list' });

    await expect(fetchProofpointProvider()).rejects.toThrow(
      'Invalid Proofpoint current-incidents response',
    );
  });

  it('rejects a response advertised beyond the payload limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(COMMUNITY_PAGE, {
          status: 200,
          headers: { 'Content-Type': 'text/html', 'Content-Length': '1048577' },
        }),
      ),
    );

    await expect(fetchProofpointProvider()).rejects.toThrow(
      'Proofpoint response exceeds 1048576 bytes',
    );
  });

  it('measures a response when content length is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(1_048_577), { status: 200 })),
    );

    await expect(fetchProofpointProvider()).rejects.toThrow(
      'Proofpoint response exceeds 1048576 bytes',
    );
  });

  it('rejects an incident link on a Proofpoint lookalike host', async () => {
    mockProofpointResponses([
      incidentRecord({
        Community_URL__c: 'https://proofpoint.my.site.com.evil.example/community/s/article/example',
      }),
    ]);

    await expect(fetchProofpointProvider()).rejects.toThrow(
      'Invalid Proofpoint current-incidents response',
    );
  });

  it('rejects a failed enterprise status request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Proofpoint unavailable')));

    await expect(fetchProofpointProvider()).rejects.toThrow('Proofpoint unavailable');
  });
});
