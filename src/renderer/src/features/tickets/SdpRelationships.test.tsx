import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI, BridgeGroup } from '@shared/ipc';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import type { SdpLink } from '@shared/sdpLinks';
import { SDP_LINK_COLLECTION, sdpTicketUrl } from '@shared/sdpLinks';
import {
  SdpBridgeDialog,
  SdpBridgePanel,
  SdpProblemTickets,
  SdpRelationships,
} from './SdpRelationships';
import { linkSdpProblem, unlinkSdpProblem } from '../../services/sdpLinkService';
import { navigateTicketWorkspace } from './ticketNavigation';

const collections = vi.hoisted(() => ({
  links: { data: [] as SdpLink[], loading: false, error: null as string | null, refetch: vi.fn() },
  problems: { data: [] as DynatraceProblemRecord[], error: null as string | null },
}));
vi.mock('../../hooks/useCollection', () => ({
  useCollection: (name: string) =>
    name === SDP_LINK_COLLECTION ? collections.links : collections.problems,
}));
vi.mock('../../services/sdpLinkService', () => ({
  linkSdpProblem: vi.fn(),
  unlinkSdpProblem: vi.fn(),
}));
vi.mock('./ticketNavigation', () => ({ navigateTicketWorkspace: vi.fn() }));

const original = globalThis.api;
const ticket = {
  id: '123',
  number: '900123',
  subject: 'Outage',
  status: 'Open',
  priority: 'High',
  group: 'NOC' as const,
  technician: '',
  createdAt: 1,
  dueAt: null,
};
const problem = {
  id: 'record-1',
  problemId: 'PROBLEM-1',
  displayId: 'P-1',
  title: 'Checkout unavailable',
  environmentUrl: 'https://example.live.dynatrace.com',
  scopeExcluded: false,
} as DynatraceProblemRecord;
const link: SdpLink = {
  id: 'link-1',
  ticketId: ticket.id,
  ticketNumber: ticket.number,
  problemId: problem.problemId,
  environment: problem.environmentUrl,
};

beforeEach(() => {
  vi.clearAllMocks();
  collections.links.data = [];
  collections.links.error = null;
  collections.links.loading = false;
  collections.links.refetch.mockResolvedValue(undefined);
  collections.problems.data = [
    problem,
    { ...problem, id: 'excluded', problemId: 'EXCLUDED', displayId: 'P-2', scopeExcluded: true },
  ];
  collections.problems.error = null;
  vi.mocked(linkSdpProblem).mockResolvedValue(link);
  vi.mocked(unlinkSdpProblem).mockResolvedValue(undefined);
});
afterEach(() => {
  globalThis.api = original;
});

it('links the selected in-scope problem using identifiers and refreshes related data', async () => {
  render(<SdpRelationships ticket={ticket} />);
  expect(screen.getByText('No linked problems.')).toBeVisible();
  fireEvent.click(screen.getByText('Link a problem'));
  expect(screen.getByRole('button', { name: 'Link problem' })).toBeDisabled();
  expect(screen.queryByRole('option', { name: /P-2/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Find a problem'), { target: { value: 'unavailable' } });
  fireEvent.change(screen.getByLabelText('Problem to link'), { target: { value: problem.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Link problem' }));
  await waitFor(() =>
    expect(linkSdpProblem).toHaveBeenCalledExactlyOnceWith({
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      problemId: problem.problemId,
      environment: problem.environmentUrl,
    }),
  );
  expect(collections.links.refetch).toHaveBeenCalledOnce();
});

it('shows only active links for this ticket and allows navigation and unlinking', async () => {
  collections.links.data = [
    link,
    { ...link, id: 'hidden', suppressed: true },
    { ...link, id: 'other', ticketId: '456' },
  ];
  render(<SdpRelationships ticket={ticket} />);
  const target = screen.getByRole('button', { name: 'P-1 · Checkout unavailable' });
  fireEvent.click(target);
  expect(navigateTicketWorkspace).toHaveBeenCalledWith({
    destination: 'problem',
    problemId: problem.problemId,
  });
  expect(screen.getAllByRole('button', { name: 'Unlink' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  await waitFor(() => expect(unlinkSdpProblem).toHaveBeenCalledExactlyOnceWith(link.id));
  expect(collections.links.refetch).toHaveBeenCalledOnce();
});

it('keeps a failed unlink visible and enables a retry without claiming success', async () => {
  collections.links.data = [link];
  collections.problems.data = [];
  vi.mocked(unlinkSdpProblem).mockRejectedValueOnce(new Error('offline'));
  render(<SdpRelationships ticket={ticket} />);
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the link');
  expect(screen.getByText(`Problem ${problem.problemId}`)).toBeVisible();
  expect(collections.links.refetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
  await waitFor(() => expect(collections.links.refetch).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('surfaces unavailable relationship data instead of implying a successful empty result', () => {
  collections.links.error = 'offline';
  render(<SdpRelationships ticket={ticket} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Related information is unavailable');
});

it('scopes problem tickets by environment and carries problem context into major-incident creation', () => {
  const openExternal = vi.fn();
  globalThis.api = { ...original, openExternal } as BridgeAPI;
  collections.links.data = [
    link,
    {
      ...link,
      id: 'foreign',
      environment: 'https://other.live.dynatrace.com',
      ticketNumber: '456',
    },
    { ...link, id: 'suppressed', suppressed: true },
  ];
  render(<SdpProblemTickets problem={problem} />);
  fireEvent.click(screen.getByRole('button', { name: `Ticket ${ticket.number}` }));
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(sdpTicketUrl(ticket.id));
  expect(screen.queryByRole('button', { name: 'Ticket 456' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Ticket actions'));
  fireEvent.click(screen.getByRole('button', { name: 'Find or link a ticket' }));
  expect(navigateTicketWorkspace).toHaveBeenLastCalledWith({
    destination: 'ticket',
    source: 'sdp',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create SDP major incident' }));
  expect(navigateTicketWorkspace).toHaveBeenLastCalledWith({
    destination: 'ticket',
    source: 'sdp',
    major: true,
    problem: { problemId: problem.problemId, environmentUrl: problem.environmentUrl },
  });
});

it('distinguishes pending, empty and failed problem-ticket lookups', () => {
  collections.links.loading = true;
  const view = render(<SdpProblemTickets problem={problem} />);
  expect(screen.getByText('Loading links…')).toBeVisible();
  collections.links.loading = false;
  view.rerender(<SdpProblemTickets problem={problem} />);
  expect(screen.getByText('No linked tickets')).toBeVisible();
  collections.links.error = 'offline';
  view.rerender(<SdpProblemTickets problem={problem} />);
  expect(screen.queryByText('No linked tickets')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Ticket links are unavailable');
});

it('rejects unsafe bridge URLs and sends only the chosen groups to the composer', () => {
  const close = vi.fn();
  render(
    <SdpBridgeDialog
      ticket={ticket}
      groups={
        [
          { id: 'noc', name: 'NOC' },
          { id: 'network', name: 'Network' },
        ] as BridgeGroup[]
      }
      onClose={close}
    />,
  );
  for (const url of [
    'invalid',
    'http://meeting.example.test',
    'https://user:password@meeting.example.test',
  ]) {
    fireEvent.change(screen.getByLabelText('Meeting link'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Open composer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use an HTTPS meeting link');
  }
  expect(navigateTicketWorkspace).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('NOC'));
  fireEvent.click(screen.getByLabelText('Network'));
  fireEvent.click(screen.getByLabelText('Network'));
  fireEvent.change(screen.getByLabelText('Meeting link'), {
    target: { value: 'https://meeting.example.test/bridge' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open composer' }));
  expect(navigateTicketWorkspace).toHaveBeenCalledWith({
    destination: 'bridge',
    bridge: {
      source: 'sdp',
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      subject: `Incident bridge · SDP ${ticket.number}`,
      meetingUrl: 'https://meeting.example.test/bridge',
      groupIds: ['noc'],
    },
  });
  expect(close).toHaveBeenCalledOnce();
});

it('copies only bridge context and reports clipboard failure without losing suggested groups', async () => {
  const writeClipboard = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error('clipboard unavailable'));
  globalThis.api = { ...original, writeClipboard } as BridgeAPI;
  const close = vi.fn();
  const useGroups = vi.fn();
  const context = {
    source: 'sdp' as const,
    ticketId: ticket.id,
    ticketNumber: ticket.number,
    subject: 'Incident bridge',
    meetingUrl: 'https://meeting.example.test/bridge',
    groupIds: ['noc'],
  };
  render(<SdpBridgePanel context={context} onClose={close} onUseGroups={useGroups} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy bridge context' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Bridge context copied');
  expect(writeClipboard).toHaveBeenCalledWith(
    `Incident bridge\n${sdpTicketUrl(ticket.id)}\n${context.meetingUrl}`,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy bridge context' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy bridge context'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use suggested groups' }));
  expect(useGroups).toHaveBeenCalledWith(['noc']);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss context' }));
  expect(close).toHaveBeenCalledOnce();
});
