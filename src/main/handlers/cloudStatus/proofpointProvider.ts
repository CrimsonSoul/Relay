import type { CloudStatusItem } from '@shared/ipc';
import { fetchNoStore } from './fetchNoStore';

const PROOFPOINT_COMMUNITY_URL =
  'https://proofpoint.my.site.com/community/s/proofpoint-current-incidents';
const PROOFPOINT_AURA_URL =
  'https://proofpoint.my.site.com/community/s/sfsites/aura?r=1&aura.FlowRuntimeConnect.startFlow=1';
const PROOFPOINT_HOST = 'proofpoint.my.site.com';
const PROOFPOINT_NO_INCIDENTS_MESSAGES = new Set([
  'No current identified incidents',
  'No current identified incidents If you are seeing a service disruption, please open a support case',
]);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_INCIDENTS = 50;
const MAX_AFFECTED_SCOPES = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

async function readBoundedText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Proofpoint response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Proofpoint response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu, (entity, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named[String(name).toLowerCase()] ?? entity;
  });
}

function removeElementContents(value: string, tag: 'script' | 'style'): string {
  const lower = value.toLowerCase();
  const closingTag = `</${tag}>`;
  let cursor = 0;
  let output = '';
  while (cursor < value.length) {
    const start = lower.indexOf(`<${tag}`, cursor);
    if (start === -1) return output + value.slice(cursor);
    output += value.slice(cursor, start);
    const openingEnd = lower.indexOf('>', start + tag.length + 1);
    if (openingEnd === -1) return output;
    const end = lower.indexOf(closingTag, openingEnd + 1);
    if (end === -1) return output;
    cursor = end + closingTag.length;
  }
  return output;
}

function removeHtmlTags(value: string): string {
  let cursor = 0;
  let output = '';
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start === -1) return output + value.slice(cursor);
    output += `${value.slice(cursor, start)} `;
    const end = value.indexOf('>', start + 1);
    if (end === -1) return output;
    cursor = end + 1;
  }
  return output;
}

function htmlToText(value: string): string {
  const withoutEmbeddedContent = removeElementContents(
    removeElementContents(value, 'script'),
    'style',
  );
  return decodeHtmlEntities(removeHtmlTags(withoutEmbeddedContent)).replace(/\s+/gu, ' ').trim();
}

function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [...row[1]!.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/giu)].map(
      (cell) => htmlToText(cell[1]!),
    );
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function incidentSummary(rows: string[][]): string {
  const summaryRow = rows.find((cells) => cells[0]?.toLowerCase() === 'summary');
  return summaryRow?.slice(1).join(' ').slice(0, 20_000) || 'Proofpoint reports a service outage.';
}

function impactedScopes(rows: string[][]): string[] {
  const scopes = rows.flatMap((cells) => {
    const impacted = cells.slice(1).some((cell) => /\bcurrently impacted\b/iu.test(cell));
    const scope = cells[0];
    return impacted && scope && scope.length <= 200 ? [scope] : [];
  });
  return [...new Set(scopes)].slice(0, MAX_AFFECTED_SCOPES);
}

function isAllowedArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === PROOFPOINT_HOST &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.startsWith('/community/s/article/')
    );
  } catch {
    return false;
  }
}

function parseIncident(candidate: unknown): CloudStatusItem<'proofpoint'> | null {
  if (
    !isRecord(candidate) ||
    !isBoundedString(candidate.ArticleNumber, 512) ||
    !isBoundedString(candidate.Title, 2_000) ||
    !isBoundedString(candidate.Community_URL__c, 2_081) ||
    !isBoundedString(candidate.LastPublishedDate, 100) ||
    !isBoundedString(candidate.FAQ_How_To_Description__c, 200_000) ||
    !isAllowedArticleUrl(candidate.Community_URL__c) ||
    !Number.isFinite(Date.parse(candidate.LastPublishedDate))
  ) {
    throw new Error('Invalid Proofpoint current-incidents response');
  }

  const rows = tableRows(candidate.FAQ_How_To_Description__c);
  const affectedScopes = impactedScopes(rows);
  if (affectedScopes.length === 0) return null;

  return {
    id: candidate.ArticleNumber,
    provider: 'proofpoint',
    title: candidate.Title,
    description: incidentSummary(rows),
    pubDate: candidate.LastPublishedDate,
    link: candidate.Community_URL__c,
    severity: 'error',
    affectedScopes,
  };
}

function extractFlowBootstrap(page: string): { fwuid: string; appVersion: string } {
  const fwuid = /fwuid%22%3A%22([^%]+)%22/u.exec(page)?.[1];
  const appVersion =
    /APPLICATION%40markup%3A%2F%2Fsiteforce%3AcommunityApp%22%3A%22([^%]+)%22/u.exec(page)?.[1];
  if (!fwuid || !appVersion || fwuid.length > 2_000 || appVersion.length > 2_000) {
    throw new Error('Invalid Proofpoint community bootstrap');
  }
  return { fwuid, appVersion };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Invalid Proofpoint current-incidents response');
  }
}

function currentIncidents(responseText: string): unknown[] {
  const body = parseJson(responseText);
  if (!isRecord(body) || !Array.isArray(body.actions)) {
    throw new Error('Invalid Proofpoint current-incidents response');
  }
  const action = body.actions.find(
    (candidate) => isRecord(candidate) && candidate.state === 'SUCCESS',
  );
  if (!isRecord(action) || !isRecord(action.returnValue)) {
    throw new Error('Invalid Proofpoint current-incidents response');
  }
  const flowResponse = action.returnValue.response;
  if (!isRecord(flowResponse) || !Array.isArray(flowResponse.fields)) {
    throw new Error('Invalid Proofpoint current-incidents response');
  }

  const hasNoIncidentsDisplay = flowResponse.fields.some(
    (field) =>
      isRecord(field) &&
      field.name === 'DisplayText' &&
      field.fieldType === 'DISPLAY_TEXT' &&
      field.dataType === 'STRING' &&
      isBoundedString(field.label, 20_000) &&
      PROOFPOINT_NO_INCIDENTS_MESSAGES.has(htmlToText(field.label)),
  );
  if (hasNoIncidentsDisplay) return [];

  const inputs = flowResponse.fields.flatMap((field) =>
    isRecord(field) && Array.isArray(field.inputs) ? field.inputs : [],
  );
  const tableData = inputs.find((input) => isRecord(input) && input.name === 'tableData');
  if (!isRecord(tableData)) {
    throw new Error('Invalid Proofpoint current-incidents response');
  }
  const value = typeof tableData.value === 'string' ? parseJson(tableData.value) : tableData.value;
  if (!Array.isArray(value) || value.length > MAX_INCIDENTS) {
    throw new Error('Invalid Proofpoint current-incidents response');
  }
  return value;
}

export async function fetchProofpointProvider(): Promise<CloudStatusItem<'proofpoint'>[]> {
  const pageResponse = await fetchNoStore(PROOFPOINT_COMMUNITY_URL, {
    credentials: 'omit',
    headers: { Accept: 'text/html' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!pageResponse.ok) {
    throw new Error(`HTTP ${pageResponse.status} from Proofpoint current incidents`);
  }
  const { fwuid, appVersion } = extractFlowBootstrap(await readBoundedText(pageResponse));

  const message = {
    actions: [
      {
        id: '1;a',
        descriptor: 'aura://FlowRuntimeConnectController/ACTION$startFlow',
        callingDescriptor: 'UNKNOWN',
        params: {
          flowDevName: 'Incident_Article_Number',
          arguments: '',
          enableTrace: false,
          enableRollbackMode: false,
          debugAsUserId: '',
          useLatestSubflow: false,
          isBuilderDebug: false,
        },
      },
    ],
  };
  const auraContext = {
    mode: 'PROD',
    fwuid,
    app: 'siteforce:communityApp',
    loaded: { 'APPLICATION@markup://siteforce:communityApp': appVersion },
    dn: [],
    globals: {},
    uad: true,
  };
  const body = new URLSearchParams({
    message: JSON.stringify(message),
    'aura.context': JSON.stringify(auraContext),
    'aura.pageURI': '/community/s/proofpoint-current-incidents',
    'aura.token': 'null',
  });
  const flowResponse = await fetchNoStore(PROOFPOINT_AURA_URL, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!flowResponse.ok) {
    throw new Error(`HTTP ${flowResponse.status} from Proofpoint current incidents`);
  }
  return currentIncidents(await readBoundedText(flowResponse)).flatMap((candidate) => {
    const item = parseIncident(candidate);
    return item ? [item] : [];
  });
}
