import React, { useState } from 'react';
import type { TabName } from '@shared/ipc';
import { Modal } from './Modal';
import { SearchInput } from './SearchInput';
import { TactileButton } from './TactileButton';
import { getRelayRuntime } from '../runtime/relayRuntime';

/**
 * Short definitions for Relay-specific terms operators meet across tabs. `tabs` lists the
 * destinations where the term appears, so Help can open scoped to the active tab.
 */
const GLOSSARY = [
  {
    term: 'Bridge',
    tabs: ['Compose', 'Personnel'],
    definition:
      'The set of people you are paging for an incident. Compose builds the bridge from groups, contacts and on-call people, then copies it or opens it as a Teams bridge.',
  },
  {
    term: 'PRI / BKP / MEM',
    tabs: ['Personnel'],
    definition:
      'On-call role codes, shown only on On-Call rows too narrow for the role word. PRI is the primary tier; BKP is the backup tier (Backup, Secondary, Standby, Escalation, Weekend); MEM is any other member. Wider rows and Compose show the full role word instead (for example "Grace Hopper · Secondary"), and hovering or focusing a code names the full role.',
  },
  {
    term: 'No coverage',
    tabs: ['Personnel', 'Compose'],
    definition:
      'A team with nobody on call this week: no person or number is assigned. Assign On-Call on the team card fills the gap; Compose lists uncovered teams under On call now so a bridge never silently misses them.',
  },
  {
    term: 'Lock Order / Unlock Order',
    tabs: ['Personnel'],
    definition:
      'On On-Call, Lock Order stops team cards from being dragged into a new order on the shared board; Unlock Order allows it again. Editing people is unaffected.',
  },
  {
    term: 'NOC response',
    tabs: ['Problems'],
    definition:
      'What your team records in Relay against a Dynatrace problem: a NOC note, and in Resolved by, who handled it. It is kept separate from Dynatrace, which still owns the problem itself.',
  },
  {
    term: 'NOC note',
    tabs: ['Problems'],
    definition:
      'The short response your team records against a Dynatrace problem on Problems: what was done and what happens next.',
  },
  {
    term: 'Addressed in Relay',
    tabs: ['Problems'],
    definition:
      'A Dynatrace problem your team has marked addressed in Relay. It stays open in Dynatrace until Dynatrace closes it.',
  },
  {
    term: 'Not syncing',
    tabs: ['Problems'],
    definition:
      "Dynatrace sync is off, failed or retrying, so the Problems queue and its sidebar count (marked with a slashed ring after its pip) are Relay's last saved copy, not live Dynatrace. An Administrator can turn sync on in Settings › Dynatrace. Sync Now (Relay server, sync on) asks Dynatrace for current problems; Refresh only reloads Relay's copy.",
  },
  {
    term: 'Third-party',
    tabs: ['Status'],
    definition:
      'A Status provider whose health Relay reads through a status aggregator (StatusGator) rather than the vendor feed directly.',
  },
  {
    term: 'Status pips',
    tabs: ['Status', 'Radar', 'Personnel'],
    definition:
      'Sidebar pips and the Status list share one shape grammar: square = outage, critical or a team with no coverage (on On-Call); diamond = degraded or warning; triangle = attention (the Radar board’s magenta state); filled circle = operational; hollow ring = waiting or no data yet; slashed ring = the feed is failing (Radar), with the time it started failing in the tooltip.',
  },
  {
    term: 'XCenter',
    tabs: ['Radar'],
    definition:
      'The XCenter Counts table on the CW Dispatcher Radar board. Radar shows its OK and Pending figures as the board reports them; — means the board did not report that figure.',
  },
  {
    term: 'PaPA Processor Service',
    tabs: ['Radar'],
    definition:
      'A message-processing service on the CW Dispatcher Radar board (PaPA is its own name). Radar lists each of its message types, such as READY and UNACKED, with its current depth.',
  },
  {
    term: 'Alerting profile',
    tabs: ['Problems', 'Settings'],
    definition:
      'The Dynatrace rule set that routes a problem to a team. "Not assigned" means no profile matched it.',
  },
  {
    term: 'Embedded Server',
    tabs: ['Settings'],
    definition:
      'The Relay server that runs inside the desktop app in server mode. It holds Relay data — the shared contacts, servers, on-call teams and other operational records — that every Relay client and Relay Web session reads. Relay Web opens this server in a browser on the same trusted network, as a backup when the desktop app is unavailable.',
  },
  {
    term: 'Clients connected',
    tabs: ['Settings'],
    definition:
      'The sidebar count on the Relay server: Relay clients (desktops in client mode) and Relay Web sessions (browsers) currently connected to it. Zero is normal when this is the only Relay workstation; hover or focus the count for connected hostnames.',
  },
  {
    term: 'Wiki publisher',
    tabs: ['Knowledge'],
    definition:
      'Anyone signed in with Publisher, Administrator or Owner access (Settings › Access): they can upload, edit and publish Knowledge Wiki documents. Everyone else reads published documents.',
  },
  {
    term: 'Accent schedule',
    tabs: ['Settings'],
    definition:
      'Optionally switches the Relay accent color automatically at set times of day, using fixed Central Time shift windows (Day, Swing, Night).',
  },
  {
    term: 'Signal Red',
    tabs: ['Settings'],
    definition:
      "Relay's default accent. Alarm red and the accent are told apart by shape, not hue: an alarm is a solid labelled chip or a square status pip, while the accent marks the selection rail, focus ring and primary button.",
  },
  {
    term: 'SDP',
    tabs: ['Tickets', 'Problems'],
    definition:
      'ServiceDesk Plus, the ticketing system. Tickets reads and changes SDP tickets through your SDP work account (Work Account on Tickets); every change is a real SDP change made as you.',
  },
  {
    term: 'NOC / SOX / Unassigned queues',
    tabs: ['Tickets'],
    definition:
      'The live SDP ticket queues on Tickets. NOC and SOX list open tickets for those support groups; Unassigned lists tickets without a support group.',
  },
  {
    term: 'Confirm Live Change',
    tabs: ['Tickets'],
    definition:
      'The final step before Relay writes to SDP. Review Change (or Review Changes) shows exactly what will change; Confirm Live Change applies it in SDP with your account, where workflows may send notifications. There is no automatic retry; Back to Editing returns to the form.',
  },
  {
    term: 'Saved copy · Read only',
    tabs: ['Tickets'],
    definition:
      'SDP could not be reached, so Tickets shows the copy Relay last saved instead of live SDP. You can read it, but Reply, Add Note, Edit Ticket and other changes stay off until the queue is Live from SDP again. Hover the sync label to see when the saved copy expires.',
  },
] as const satisfies readonly { term: string; tabs: readonly TabName[]; definition: string }[];

/** Task-oriented steps for the most common operator jobs. */
const HOW_TO = [
  {
    task: 'Assemble a bridge',
    tabs: ['Compose', 'Personnel'],
    steps:
      'On On-Call choose Add to Bridge, or on Compose choose Add All On Call or pick groups and search contacts. Review recipients, then Copy Recipients or New Teams Bridge.',
  },
  {
    task: 'Assign on-call coverage',
    tabs: ['Personnel'],
    steps:
      'On On-Call choose Assign On-Call on a team with no coverage, or open the team menu (··· button, right-click, Shift + F10 or the Menu key on a focused card) and choose Edit Team.',
  },
  {
    task: 'Reorder or lock team cards',
    tabs: ['Personnel'],
    steps:
      'On On-Call drag a team card to a new position. Lock Order stops reordering for everyone; Unlock Order allows it again.',
  },
  {
    task: 'Share on-call info',
    tabs: ['Personnel'],
    steps:
      'On On-Call choose Copy All for the whole board, Copy On-Call Info in a team menu for one team, or Add to Bridge to send everyone to Compose.',
  },
  {
    task: 'Address a problem',
    tabs: ['Problems'],
    steps:
      'On Problems select the problem, write the NOC note, choose who resolved it, then Mark Addressed in Relay.',
  },
  {
    task: 'Send an alert',
    tabs: ['Alerts'],
    steps:
      'On Alerts pick a severity, fill in the subject and message, check the preview, then Open in Outlook (or Download Draft in Relay Web).',
  },
  {
    task: 'Check provider status',
    tabs: ['Status'],
    steps:
      'On Status read each provider pip, select a provider row for its incidents and components, and choose Refresh for the latest feeds.',
  },
  {
    task: 'Watch the dispatcher queues',
    tabs: ['Radar'],
    steps:
      'On Radar read the XCenter counts and PaPA Processor Service depths. Choose Refresh for a new snapshot, Open Radar for the live dashboard, or Sign In when the CW Dashboard session has expired.',
  },
  {
    task: 'Find reference information',
    tabs: ['Knowledge'],
    steps:
      'On Knowledge choose Open Wiki, Open Contacts or Open Servers; the Knowledge sidebar item returns to the last one you used. In an open Wiki document use Find; Wiki publishers choose Manage Wiki to upload and publish.',
  },
  {
    task: 'Jump to anything or run a command',
    tabs: ['Compose', 'Personnel', 'Problems', 'Alerts'],
    steps:
      'Choose Search Relay (or press its shortcut, shown in the field) and type an open problem’s ID such as P-1001 or its title, an on-call team, a person, a group, a server or a Wiki page; Enter opens it. Type Copy All On-Call Info, Add All On Call to Bridge, Clear Bridge, Reset Alert or Open Help to run that command on its tab.',
  },
  {
    task: 'Reply to a ticket',
    tabs: ['Tickets'],
    steps:
      'On Tickets open the ticket and choose Reply (or press R). Write the email, choose Review Email, check it, then Confirm and Send.',
  },
  {
    task: 'Route or assign a ticket',
    tabs: ['Tickets'],
    steps:
      'On Tickets open the ticket, choose Edit Ticket, change Support group or Technician, choose Review Changes, then Confirm Live Change.',
  },
  {
    task: 'Merge duplicate tickets',
    tabs: ['Tickets'],
    steps:
      'On Tickets open the ticket to keep, go to Links & bridge, expand Link or Merge a Ticket, enter the duplicate’s ticket number and choose Find Ticket, then Merge Duplicate Into the open ticket and confirm. A merge cannot be undone in Relay.',
  },
  {
    task: 'Update several tickets at once',
    tabs: ['Tickets'],
    steps:
      'On Tickets choose Select Page (up to 20 tickets) or tick tickets in the queue, choose Update Selected, set the fields, choose Review Bulk Changes, then Confirm Live Changes (the button shows the ticket count). A conflict stops the remaining changes.',
  },
  {
    task: 'Back up or restore Relay data',
    tabs: ['Settings'],
    steps:
      'In Settings under Relay data choose Open Data Manager, then Backups. Create Backup makes a recovery point and Verify Backup checks one. Restore replaces all current data after a safety backup of the current state.',
  },
] as const satisfies readonly { task: string; tabs: readonly TabName[]; steps: string }[];

/** Help names each destination by its nav label. */
const TAB_HELP_LABELS: Record<TabName, string> = {
  Compose: 'Compose',
  Alerts: 'Alerts',
  Personnel: 'On-Call',
  Knowledge: 'Knowledge',
  Status: 'Status',
  Problems: 'Problems',
  Tickets: 'Tickets',
  Radar: 'Radar',
  Settings: 'Settings',
};

type ShortcutItem = { keys: string; description: string };
type ShortcutSection = { category: string; tab?: TabName; items: ShortcutItem[] };

function getShortcuts(modKey: string, editKey: string, isWeb: boolean): ShortcutSection[] {
  // Tab commands use Mod+Shift on desktop; Relay Web's Alt + Shift avoids browser chords.
  const commandKey = isWeb ? modKey : `${editKey} + Shift`;
  return [
    {
      category: 'Navigation',
      items: [
        { keys: `${modKey} + 1`, description: 'Go to Compose' },
        { keys: `${modKey} + 2`, description: 'Go to Alerts' },
        { keys: `${modKey} + 3`, description: 'Go to On-Call' },
        { keys: `${modKey} + 4`, description: 'Go to Knowledge' },
        { keys: `${modKey} + 5`, description: 'Go to Status' },
        { keys: `${modKey} + 6`, description: 'Go to Problems' },
        { keys: `${modKey} + 7`, description: 'Go to Radar' },
        { keys: `${modKey} + 8`, description: 'Go to Tickets' },
      ],
    },
    {
      category: 'Compose',
      tab: 'Compose',
      items: [
        { keys: `${commandKey} + C`, description: 'Copy Recipients' },
        { keys: `${commandKey} + M`, description: 'New Teams Bridge (opens review)' },
      ],
    },
    {
      category: 'Alerts',
      tab: 'Alerts',
      items: [
        { keys: `${editKey} + S`, description: 'Save alert image' },
        { keys: `${editKey} + Enter`, description: 'Open alert draft in Outlook' },
        { keys: `${editKey} + B / I / U`, description: 'Bold, italic, underline (in body)' },
        { keys: `${editKey} + 1 – 5`, description: 'Highlight selected body text' },
        { keys: `${editKey} + 0`, description: 'Clear highlight (in body)' },
      ],
    },
    {
      category: 'Knowledge',
      tab: 'Knowledge',
      items: [{ keys: `${editKey} + F`, description: 'Find in the open document' }],
    },
    {
      category: 'Problems',
      tab: 'Problems',
      items: [
        { keys: 'Alt + ↓ / ↑', description: 'Next or previous problem in the current view' },
        { keys: 'Alt + 1 / 2 / 3', description: 'Unaddressed, Addressed in Relay, or History' },
        { keys: 'Alt + N', description: 'Focus selected problem note' },
        { keys: '/', description: 'Search problems' },
        { keys: `${editKey} + Enter`, description: 'Mark Addressed in Relay or save the response' },
      ],
    },
    {
      category: 'On-Call',
      tab: 'Personnel',
      items: [
        { keys: `${commandKey} + C`, description: 'Copy All' },
        { keys: `${commandKey} + B`, description: 'Add to Bridge' },
        { keys: 'Shift + F10 / Menu', description: 'Open the team menu (focused team card)' },
      ],
    },
    {
      category: 'Tickets',
      tab: 'Tickets',
      items: [
        { keys: 'J / K', description: 'Next or previous ticket in the queue' },
        { keys: 'R', description: 'Reply to the open ticket' },
        { keys: 'Escape', description: 'Back to the queue' },
      ],
    },
    {
      category: 'Actions',
      items: [
        { keys: `${modKey} + K`, description: 'Search Relay' },
        { keys: 'Shift + Enter', description: 'Add highlighted contact to bridge (in search)' },
        { keys: `${modKey} + ,`, description: 'Open Settings' },
        {
          keys: formatHelpShortcut(modKey, isWeb),
          description: 'Show help and shortcuts',
        },
      ],
    },
    {
      category: 'General',
      items: [
        { keys: 'Escape', description: 'Close modal / dialog' },
        { keys: '↑ ↓', description: 'Navigate lists' },
        { keys: 'Enter', description: 'Select / confirm' },
        { keys: 'Shift + F10 / Menu', description: 'Open the context menu for the focused item' },
      ],
    },
  ];
}

function getShortcutModifier(isWeb: boolean, isMac: boolean): string {
  if (isWeb) return 'Alt + Shift';
  return isMac ? '⌘' : 'Ctrl';
}

// Shift+/ is the physical key for "?"; web's modifier already includes Shift.
function formatHelpShortcut(modKey: string, isWeb: boolean): string {
  return isWeb ? `${modKey} + /` : `${modKey} + Shift + /`;
}

/** The Help shortcut as this runtime spells it, for the header Help button's Tooltip. */
export function getHelpShortcut(): string {
  const isWeb = getRelayRuntime().kind === 'web';
  const isMac = globalThis.window?.api?.platform === 'darwin';
  return formatHelpShortcut(getShortcutModifier(isWeb, isMac), isWeb);
}

function includesQuery(query: string, ...texts: string[]): boolean {
  return texts.some((text) => text.toLowerCase().includes(query));
}

function filterShortcuts(sections: ShortcutSection[], query: string): ShortcutSection[] {
  if (!query) return sections;
  return sections
    .map((section) =>
      includesQuery(query, section.category)
        ? section
        : {
            ...section,
            items: section.items.filter((item) =>
              includesQuery(query, item.keys, item.description),
            ),
          },
    )
    .filter((section) => section.items.length > 0);
}

type HelpContent = {
  shortcuts: ShortcutSection[];
  tasks: (typeof HOW_TO)[number][];
  terms: (typeof GLOSSARY)[number][];
};

/** A query searches all of Help; otherwise a scope keeps only the active tab's entries. */
function selectHelpContent(
  allShortcuts: ShortcutSection[],
  query: string,
  scope: TabName | null,
): HelpContent {
  if (query || !scope) {
    return {
      shortcuts: filterShortcuts(allShortcuts, query),
      tasks: HOW_TO.filter((entry) => includesQuery(query, entry.task, entry.steps)),
      terms: GLOSSARY.filter((entry) => includesQuery(query, entry.term, entry.definition)),
    };
  }
  const inScope = (tabs: readonly TabName[]) => tabs.includes(scope);
  return {
    shortcuts: allShortcuts.filter((section) => section.tab === scope),
    tasks: HOW_TO.filter((entry) => inScope(entry.tabs)),
    terms: GLOSSARY.filter((entry) => inScope(entry.tabs)),
  };
}

function HelpScopeBar({
  label,
  scoped,
  onToggle,
}: Readonly<{ label: string; scoped: boolean; onToggle: () => void }>) {
  return (
    <div className="shortcuts-modal-scope">
      <span>{scoped ? `Showing help for ${label}` : 'Showing all help'}</span>
      <TactileButton size="xs" variant="ghost" onClick={onToggle}>
        {scoped ? 'Show All' : `Show ${label} Only`}
      </TactileButton>
    </div>
  );
}

function ShortcutSections({ sections }: Readonly<{ sections: ShortcutSection[] }>) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.category} className="shortcuts-modal-category">
          <h3 className="shortcuts-modal-category-title">{section.category}</h3>
          <div className="shortcuts-modal-items">
            {section.items.map((item) => (
              <div key={item.keys} className="shortcuts-modal-item">
                <span className="shortcuts-modal-item-desc">{item.description}</span>
                <kbd className="shortcuts-modal-key">{item.keys}</kbd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function HowToSection({ tasks }: Readonly<{ tasks: HelpContent['tasks'] }>) {
  if (tasks.length === 0) return null;
  return (
    <section className="shortcuts-modal-category" aria-labelledby="shortcuts-howto-title">
      <h3 id="shortcuts-howto-title" className="shortcuts-modal-category-title">
        How to
      </h3>
      <dl className="shortcuts-modal-glossary">
        {tasks.map((entry) => (
          <div key={entry.task} className="shortcuts-modal-item">
            <dt className="shortcuts-modal-item-desc">{entry.task}</dt>
            <dd className="shortcuts-modal-glossary-definition">{entry.steps}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function GlossarySection({ terms }: Readonly<{ terms: HelpContent['terms'] }>) {
  if (terms.length === 0) return null;
  return (
    <section className="shortcuts-modal-category" aria-labelledby="shortcuts-glossary-title">
      <h3 id="shortcuts-glossary-title" className="shortcuts-modal-category-title">
        Relay terms
      </h3>
      <dl className="shortcuts-modal-glossary">
        {terms.map((entry) => (
          <div key={entry.term} className="shortcuts-modal-item">
            <dt className="shortcuts-modal-item-desc">{entry.term}</dt>
            <dd className="shortcuts-modal-glossary-definition">{entry.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type ShortcutsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** The active tab: Help opens filtered to its entries, with Show All to widen. */
  scope?: TabName;
};

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose, scope }) => {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(!scope);
  const isWeb = getRelayRuntime().kind === 'web';
  const isMac = globalThis.window?.api?.platform === 'darwin';
  const modKey = getShortcutModifier(isWeb, isMac);
  // Tab-level editing shortcuts listen for the platform command key in every runtime.
  const editKey = isMac ? '⌘' : 'Ctrl';
  const query = filter.trim().toLowerCase();
  const activeScope = scope && !showAll ? scope : null;
  const { shortcuts, tasks, terms } = selectHelpContent(
    getShortcuts(modKey, editKey, isWeb),
    query,
    activeScope,
  );
  const hasResults = shortcuts.length > 0 || tasks.length > 0 || terms.length > 0;
  const handleClose = () => {
    setFilter('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Help and keyboard shortcuts"
      variant="standard"
      bodyClassName="shortcuts-modal-content"
      footer={
        <span className="shortcuts-modal-hint">
          Press <kbd className="shortcuts-modal-kbd">Esc</kbd> to close
        </span>
      }
    >
      <div className="shortcuts-modal-filter">
        <SearchInput
          type="search"
          aria-label="Filter help"
          placeholder="Filter shortcuts, tasks and terms"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {scope && !query && (
          <HelpScopeBar
            label={TAB_HELP_LABELS[scope]}
            scoped={activeScope !== null}
            onToggle={() => setShowAll((current) => !current)}
          />
        )}
      </div>
      {isWeb && !query && (
        <p className="shortcuts-modal-runtime-note">
          Relay Web uses Alt + Shift to avoid browser-reserved shortcuts. Escape does not dismiss an
          expired-session sign-in.
        </p>
      )}
      {/* Mounted empty (and out of flow) so the no-match message is announced when it arrives. */}
      <p // NOSONAR - role=status is the live-region pattern; <output> would imply a calculated result.
        className={hasResults ? 'sr-only' : 'shortcuts-modal-empty'}
        role="status"
      >
        {!hasResults && `Nothing in Help matches “${filter.trim()}”.`}
      </p>
      <ShortcutSections sections={shortcuts} />
      <HowToSection tasks={tasks} />
      <GlossarySection terms={terms} />
    </Modal>
  );
};
