import { useMemo } from 'react';
import { Contact, Server, BridgeGroup, OnCallRow } from '@shared/ipc';
import type { KnowledgeDocumentRecord, KnowledgeOutlineNode } from '@shared/knowledge';
import { normalizeKnowledgeSearchText } from '@shared/knowledge';
import {
  getDynatraceProblemDisplayTitle,
  type DynatraceProblemRecord,
} from '@shared/dynatraceProblems';
import { knowledgeDocumentMatches } from '../features/knowledge/knowledgeModel';
import type { TabCommandId } from './useTabCommandShortcuts';

export type ResultType =
  'contact' | 'server' | 'group' | 'knowledge' | 'team' | 'problem' | 'action';

/** Selecting a `team` result opens On-Call; the board has no per-team focus target. */
export type TeamSearchData = { teamId: string; team: string };
/** Selecting a `problem` result opens Problems with that problem selected. */
export type ProblemSearchData = { problemId: string };
export type TabCommandSearchData = { action: 'tab-command'; tab: string; command: TabCommandId };

export type CommandSearchSources = Readonly<{
  onCall?: readonly OnCallRow[];
  /** Open, in-scope Dynatrace problems already held by the renderer. */
  problems?: readonly DynatraceProblemRecord[];
}>;

const TEAM_PEOPLE_PREVIEW = 3;
const NO_ON_CALL: readonly OnCallRow[] = [];
const NO_PROBLEMS: readonly DynatraceProblemRecord[] = [];

export type SearchResult = {
  id: string;
  type: ResultType;
  source?: 'wiki-passage';
  title: string;
  subtitle?: string;
  iconType: string;
  data: unknown;
};

function findMatchingKnowledgeHeading(
  document: KnowledgeDocumentRecord,
  terms: string[],
): KnowledgeOutlineNode | undefined {
  return document.outline.find((node) =>
    terms.every((term) => normalizeKnowledgeSearchText(node.label).includes(term)),
  );
}

function describeTeamCoverage(rows: readonly OnCallRow[]): string {
  const staffed = rows.filter((row) => row.name.trim());
  if (staffed.length === 0) return 'No coverage';
  const people = staffed
    .slice(0, TEAM_PEOPLE_PREVIEW)
    .map((row) => (row.role.trim() ? `${row.name} (${row.role})` : row.name));
  const more = staffed.length - TEAM_PEOPLE_PREVIEW;
  return more > 0 ? `${people.join(' · ')} · +${more} more` : people.join(' · ');
}

function teamResults(onCall: readonly OnCallRow[], lower: string): SearchResult[] {
  const teams = new Map<string, OnCallRow[]>();
  for (const row of onCall) {
    const rows = teams.get(row.teamId);
    if (rows) rows.push(row);
    else teams.set(row.teamId, [row]);
  }
  return [...teams].flatMap(([teamId, rows]) => {
    const team = rows[0]?.team ?? '';
    if (!team.toLowerCase().includes(lower)) return [];
    const data: TeamSearchData = { teamId, team };
    return [
      {
        id: `team-${teamId}`,
        type: 'team' as const,
        title: team,
        subtitle: describeTeamCoverage(rows),
        iconType: 'personnel',
        data,
      },
    ];
  });
}

function problemResults(
  problems: readonly DynatraceProblemRecord[],
  lower: string,
): SearchResult[] {
  return problems.flatMap((problem) => {
    const title = getDynatraceProblemDisplayTitle(problem);
    const displayId = problem.displayId || problem.problemId;
    if (!`${displayId} ${title}`.toLowerCase().includes(lower)) return [];
    const data: ProblemSearchData = { problemId: problem.problemId };
    return [
      {
        id: `problem-${problem.problemId}`,
        type: 'problem' as const,
        title: displayId + ' · ' + title,
        subtitle: 'Dynatrace problem · currently open',
        iconType: 'problems',
        data,
      },
    ];
  });
}

function tabCommand(
  command: TabCommandId,
  tab: string,
  title: string,
  subtitle: string,
  iconType: string,
): SearchResult {
  const data: TabCommandSearchData = { action: 'tab-command', tab, command };
  return { id: `command-${command}`, type: 'action', title, subtitle, iconType, data };
}

export function useCommandSearch(
  query: string,
  contacts: Contact[],
  servers: Server[],
  groups: BridgeGroup[],
  knowledgeDocuments: KnowledgeDocumentRecord[] = [],
  { onCall = NO_ON_CALL, problems = NO_PROBLEMS }: CommandSearchSources = {},
) {
  return useMemo((): SearchResult[] => {
    const actions: SearchResult[] = [
      {
        id: 'action-compose',
        type: 'action',
        title: 'Go to Compose',
        subtitle: 'Assemble bridge recipients and start a bridge',
        iconType: 'compose',
        data: { action: 'navigate', tab: 'Compose' },
      },
      {
        id: 'action-alerts',
        type: 'action',
        title: 'Go to Alerts',
        subtitle: 'Compose and export an alert',
        iconType: 'alerts',
        data: { action: 'navigate', tab: 'Alerts' },
      },
      {
        id: 'action-personnel',
        type: 'action',
        title: 'Go to On-Call',
        subtitle: 'See and edit who is on call for each team',
        iconType: 'personnel',
        data: { action: 'navigate', tab: 'Personnel' },
      },
      {
        id: 'action-contacts',
        type: 'action',
        title: 'Go to Contacts',
        subtitle: 'Search the contacts directory',
        iconType: 'people',
        data: { action: 'open-knowledge', destination: 'contacts' },
      },
      {
        id: 'action-wiki',
        type: 'action',
        title: 'Go to Wiki',
        subtitle: 'Open the shared guidance library',
        iconType: 'wiki',
        data: { action: 'open-knowledge', destination: 'wiki' },
      },
      {
        id: 'action-servers',
        type: 'action',
        title: 'Go to Servers',
        subtitle: 'Search the server directory',
        iconType: 'servers',
        data: { action: 'open-knowledge', destination: 'servers' },
      },
      {
        id: 'action-problems',
        type: 'action',
        title: 'Go to Problems',
        subtitle: 'Review Dynatrace problems needing a NOC response',
        iconType: 'problems',
        data: { action: 'navigate', tab: 'Problems' },
      },
      {
        id: 'action-status',
        type: 'action',
        title: 'Go to Status',
        subtitle: 'Check external cloud and vendor service health',
        iconType: 'status',
        data: { action: 'navigate', tab: 'Status' },
      },
      {
        id: 'action-radar',
        type: 'action',
        title: 'Go to Radar',
        subtitle: 'Watch the CW Dispatcher Radar queues',
        iconType: 'radar',
        data: { action: 'navigate', tab: 'Radar' },
      },
      {
        id: 'action-tickets',
        type: 'action',
        title: 'Go to Tickets',
        subtitle: 'Work SDP ticket queues and search all of SDP',
        iconType: 'tickets',
        data: { action: 'navigate', tab: 'Tickets' },
      },
      {
        id: 'action-settings',
        type: 'action',
        title: 'Go to Settings',
        subtitle: 'Configure Relay',
        iconType: 'settings',
        data: { action: 'navigate', tab: 'Settings' },
      },
      {
        id: 'action-create-contact',
        type: 'action',
        title: 'Create New Contact',
        subtitle: 'Add a new person to the directory',
        iconType: 'add-contact',
        data: { action: 'create-contact' },
      },
      tabCommand(
        'copy-all-on-call',
        'Personnel',
        'Copy All On-Call Info',
        'Copy every team on the On-Call board',
        'personnel',
      ),
      tabCommand(
        'add-all-on-call-to-bridge',
        'Personnel',
        'Add All On Call to Bridge',
        'Add everyone on call with a contact email to the bridge and open Compose',
        'add',
      ),
      tabCommand(
        'clear-bridge',
        'Compose',
        'Clear Bridge',
        'Clear groups and recipients on Compose; Undo restores them',
        'compose',
      ),
      tabCommand(
        'reset-alert',
        'Alerts',
        'Reset Alert',
        'Clear the alert you are composing; Undo restores it',
        'alerts',
      ),
      {
        id: 'action-open-help',
        type: 'action',
        title: 'Open Help',
        subtitle: 'Help for this tab, keyboard shortcuts and Relay terms',
        iconType: 'help',
        data: { action: 'open-help' },
      },
    ];
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return actions;

    const lower = trimmedQuery.toLowerCase();
    const matchingActions = actions.filter((item) =>
      `${item.title} ${item.subtitle ?? ''}`.toLowerCase().includes(lower),
    );
    const results: SearchResult[] = [
      ...problemResults(problems, lower),
      ...teamResults(onCall, lower),
    ];

    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(query.trim());
    const emailExists = contacts.some((c) => c.email.toLowerCase() === lower);

    if (isEmail) {
      results.push({
        id: 'action-add-manual',
        type: 'action',
        title: `Add "${query}" to Compose`,
        subtitle: 'Manually add to bridge recipients',
        iconType: 'add',
        data: { action: 'add-manual', value: query },
      });

      if (!emailExists) {
        results.push({
          id: 'action-create-contact-email',
          type: 'action',
          title: `Create Contact: ${query}`,
          subtitle: 'Add new contact with this email',
          iconType: 'add-contact',
          data: { action: 'create-contact', value: query },
        });
      }
    }

    groups.forEach((group) => {
      if (group.name.toLowerCase().includes(lower)) {
        results.push({
          id: `group-${group.id}`,
          type: 'group',
          title: group.name,
          subtitle: `${group.contacts.length} member${group.contacts.length === 1 ? '' : 's'}`,
          iconType: 'group',
          data: group,
        });
      }
    });

    contacts.forEach((contact) => {
      if (contact._searchString.includes(lower)) {
        results.push({
          id: `contact-${contact.email}`,
          type: 'contact',
          title: contact.name || contact.email,
          subtitle: contact.name ? contact.email : contact.title || undefined,
          iconType: 'contact',
          data: contact,
        });
      }
    });

    servers.forEach((server) => {
      if (server._searchString.includes(lower)) {
        results.push({
          id: `server-${server.name}`,
          type: 'server',
          title: server.name,
          subtitle: server.businessArea || server.owner || undefined,
          iconType: 'server',
          data: server,
        });
      }
    });

    const normalizedQuery = normalizeKnowledgeSearchText(query);
    const knowledgeQueryTerms = normalizedQuery.split(' ');
    knowledgeDocuments.forEach((document) => {
      if (!knowledgeDocumentMatches(document, query)) return;
      const heading = findMatchingKnowledgeHeading(document, knowledgeQueryTerms);
      results.push({
        id: `knowledge-${document.id}`,
        type: 'knowledge',
        title: document.title,
        subtitle: heading ? `${document.category} · ${heading.label}` : document.category,
        iconType: 'knowledge',
        data: { document, headingId: heading?.id },
      });
    });

    // SDP-wide ticket search runs in Tickets, where the desktop app holds the SDP sign-in.
    if (globalThis.api?.runtime.kind === 'electron' && trimmedQuery.length <= 200)
      matchingActions.push({
        id: 'action-search-sdp',
        type: 'action',
        title: `Search SDP for "${trimmedQuery}"`,
        subtitle: 'Find tickets by number, subject, requester or technician across all of SDP',
        iconType: 'tickets',
        data: { action: 'search-sdp', value: trimmedQuery },
      });
    return [...results, ...matchingActions];
  }, [query, contacts, servers, groups, knowledgeDocuments, onCall, problems]);
}
