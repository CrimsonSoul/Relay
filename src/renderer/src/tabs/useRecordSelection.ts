import { useEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';
import type { ListImperativeAPI } from 'react-window';
import type {
  KnowledgeRecordDestination,
  KnowledgeRecordOpenRequest,
} from '../features/knowledge/knowledgeRecordNavigation';

type RecordSelectionOptions<T> = {
  destination: KnowledgeRecordDestination;
  /** Every record the tab holds, so a request for a missing one is reported, not guessed at. */
  records: readonly T[];
  /** The records the list shows after search and filters. */
  displayed: readonly T[];
  recordKey: (record: T) => string;
  selectionRequest?: KnowledgeRecordOpenRequest | null;
  onSelectionUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  /** Moving the focused row also selects it (Contacts); otherwise only a click or Enter does. */
  selectFocusedRecord?: boolean;
  /** Clears the focused row too when a request names a record that no longer exists. */
  clearFocusWhenUnavailable?: boolean;
  setSearchQuery: (query: string) => void;
  clearAllFilters: () => void;
  listRef: RefObject<ListImperativeAPI | null>;
  listContainerRef: RefObject<HTMLElement | null>;
  /** The record an open menu, notes editor or delete confirmation acts on. */
  menuTarget: T | null | undefined;
};

function focusRenderedRecord(container: HTMLElement | null, recordKey: string): void {
  const row = Array.from(container?.querySelectorAll<HTMLElement>('[data-record-key]') ?? []).find(
    (node) => node.dataset.recordKey === recordKey,
  );
  row?.focus();
}

/**
 * Selection shared by the Contacts and Servers lists. The detail panel is bound to the stable
 * navigation key, never a row position or display name: filters reorder the list, and duplicate
 * names must not redirect edit or delete actions. `selectedRecordKey` is null before anything is
 * picked and '' when the selection was cleared, so each tab chooses its own fallback row.
 */
export function useRecordSelection<T>({
  destination,
  records,
  displayed,
  recordKey,
  selectionRequest,
  onSelectionUnavailable,
  focusedIndex,
  setFocusedIndex,
  selectFocusedRecord = false,
  clearFocusWhenUnavailable = false,
  setSearchQuery,
  clearAllFilters,
  listRef,
  listContainerRef,
  menuTarget,
}: RecordSelectionOptions<T>) {
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null);
  const lastConsumedRequestIdRef = useRef<number | null>(null);
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(null);
  const lastFocusedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectFocusedRecord || lastFocusedIndexRef.current === focusedIndex) return;
    lastFocusedIndexRef.current = focusedIndex;
    const focusedRecord = displayed[focusedIndex];
    setSelectedRecordKey(focusedRecord ? recordKey(focusedRecord) : null);
  }, [displayed, focusedIndex, recordKey, selectFocusedRecord]);

  // A knowledge citation opens its record: clear search and filters so the row is reachable,
  // then select and focus it once the list shows it.
  useEffect(() => {
    if (
      selectionRequest?.destination !== destination ||
      lastConsumedRequestIdRef.current === selectionRequest.requestId
    ) {
      return;
    }

    lastConsumedRequestIdRef.current = selectionRequest.requestId;
    const hasRequestedRecord = records.some(
      (record) => recordKey(record) === selectionRequest.recordKey,
    );
    if (!hasRequestedRecord) {
      setPendingSelectionKey(null);
      setSelectedRecordKey('');
      if (clearFocusWhenUnavailable) setFocusedIndex(-1);
      onSelectionUnavailable?.(selectionRequest);
      return;
    }

    setSearchQuery('');
    clearAllFilters();
    setPendingSelectionKey(selectionRequest.recordKey);
  }, [
    clearAllFilters,
    clearFocusWhenUnavailable,
    destination,
    onSelectionUnavailable,
    recordKey,
    records,
    selectionRequest,
    setFocusedIndex,
    setSearchQuery,
  ]);

  useEffect(() => {
    if (!pendingSelectionKey) return;
    const requestedIndex = displayed.findIndex(
      (record) => recordKey(record) === pendingSelectionKey,
    );
    if (requestedIndex < 0) return;

    const requestedRecord = displayed[requestedIndex];
    if (!requestedRecord) return;
    setSelectedRecordKey(recordKey(requestedRecord));
    setFocusedIndex(requestedIndex);
    listRef.current?.scrollToRow({ index: requestedIndex, align: 'smart' });

    const frame = requestAnimationFrame(() => {
      focusRenderedRecord(listContainerRef.current, pendingSelectionKey);
      setPendingSelectionKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [displayed, listContainerRef, listRef, pendingSelectionKey, recordKey, setFocusedIndex]);

  // Keyboard focus follows the focused index so arrow keys move the real focus ring, not just
  // the selection highlight. Only when focus is already inside the list: never steal it.
  useEffect(() => {
    const container = listContainerRef.current;
    const record = displayed[focusedIndex];
    if (!container || !record || !container.contains(document.activeElement)) return;
    const key = recordKey(record);
    if ((document.activeElement as HTMLElement | null)?.dataset.recordKey === key) return;
    const frame = requestAnimationFrame(() => focusRenderedRecord(container, key));
    return () => cancelAnimationFrame(frame);
  }, [displayed, focusedIndex, listContainerRef, recordKey]);

  // The row an open menu, notes editor or delete confirm acts on stays outlined.
  const menuTargetKey = menuTarget ? recordKey(menuTarget) : null;
  const menuTargetIndex = menuTargetKey
    ? displayed.findIndex((record) => recordKey(record) === menuTargetKey)
    : -1;

  const handleListFocus = (event: FocusEvent<HTMLElement>) => {
    const key = (event.target as HTMLElement).dataset?.recordKey;
    if (!key) return;
    const index = displayed.findIndex((record) => recordKey(record) === key);
    if (index >= 0 && index !== focusedIndex) setFocusedIndex(index);
  };

  return { selectedRecordKey, setSelectedRecordKey, menuTargetIndex, handleListFocus };
}
