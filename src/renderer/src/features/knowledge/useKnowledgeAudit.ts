import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  normalizeKnowledgeAuditEventView,
  type KnowledgeAuditEventView,
  type KnowledgePage,
} from '@shared/knowledge';
import type { PrivilegedCommandContextValue } from '../../contexts/PrivilegedCommandContext';
import { knowledgeCommandError } from './knowledgeManagementErrors';

type UseKnowledgeAuditOptions = {
  canManage: boolean;
  managementIdentity: string | null;
  submitCommand: PrivilegedCommandContextValue['submitCommand'];
  setBusy: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

type AuditPageRead =
  { page: KnowledgePage<KnowledgeAuditEventView>; error: null } | { page: null; error: string };

export function normalizeKnowledgeAuditPage(
  value: unknown,
): KnowledgePage<KnowledgeAuditEventView> | null {
  if (!value || typeof value !== 'object' || !('items' in value)) return null;
  const { items, nextCursor } = value as { items: unknown; nextCursor?: unknown };
  if (!Array.isArray(items)) return null;
  if (nextCursor !== null && typeof nextCursor !== 'string') return null;
  const normalized = items.map(normalizeKnowledgeAuditEventView);
  return normalized.includes(null)
    ? null
    : { items: normalized as KnowledgeAuditEventView[], nextCursor };
}

export function useKnowledgeAudit({
  canManage,
  managementIdentity,
  submitCommand,
  setBusy,
  setError,
}: UseKnowledgeAuditOptions) {
  const [auditEvents, setAuditEvents] = useState<KnowledgeAuditEventView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const managementIdentityRef = useRef(managementIdentity);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  managementIdentityRef.current = managementIdentity;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  const resetAudit = useCallback(() => {
    requestGenerationRef.current += 1;
    setAuditEvents([]);
    setAuditNextCursor(null);
  }, []);

  const requestAuditPage = useCallback(
    async (cursor: string | null): Promise<AuditPageRead> => {
      const result = await submitCommand({
        command: 'knowledge.audit.read',
        payload: { cursor, pageSize: 25, targetId: null },
        expectedRevision: null,
      });
      if (!result.ok) {
        return { page: null, error: knowledgeCommandError(result) };
      }
      const normalized = normalizeKnowledgeAuditPage(result.value);
      return normalized
        ? { page: normalized, error: null }
        : { page: null, error: 'Relay returned an invalid Wiki audit history.' };
    },
    [submitCommand],
  );
  const isRequestCurrent = useCallback(
    (expectedIdentity: string, generation: number) =>
      mountedRef.current &&
      managementIdentityRef.current === expectedIdentity &&
      requestGenerationRef.current === generation,
    [],
  );

  const readAudit = useCallback(async (): Promise<boolean> => {
    const expectedIdentity = managementIdentityRef.current;
    if (!canManage || !expectedIdentity) return false;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const busyKey = 'audit';
    setBusy(busyKey);
    setError(null);
    try {
      const result = await requestAuditPage(null);
      if (!isRequestCurrent(expectedIdentity, generation)) return false;
      const page = result.page;
      if (!page) {
        setError(result.error);
        return false;
      }
      setAuditEvents(page.items);
      setAuditNextCursor(page.nextCursor);
      return true;
    } finally {
      if (isRequestCurrent(expectedIdentity, generation)) {
        setBusy((current) => (current === busyKey ? null : current));
      }
    }
  }, [canManage, isRequestCurrent, requestAuditPage, setBusy, setError]);

  const loadMoreAudit = useCallback(async (): Promise<boolean> => {
    const expectedIdentity = managementIdentityRef.current;
    if (!canManage || !expectedIdentity || !auditNextCursor) return false;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const busyKey = 'more:audit';
    setBusy(busyKey);
    setError(null);
    try {
      const result = await requestAuditPage(auditNextCursor);
      if (!isRequestCurrent(expectedIdentity, generation)) return false;
      const page = result.page;
      if (!page) {
        setError(result.error);
        return false;
      }
      setAuditEvents((current) => {
        const existing = new Set(current.map(({ id }) => id));
        return [...current, ...page.items.filter(({ id }) => !existing.has(id))];
      });
      setAuditNextCursor(page.nextCursor);
      return true;
    } finally {
      if (isRequestCurrent(expectedIdentity, generation)) {
        setBusy((current) => (current === busyKey ? null : current));
      }
    }
  }, [auditNextCursor, canManage, isRequestCurrent, requestAuditPage, setBusy, setError]);

  return { auditEvents, auditNextCursor, readAudit, loadMoreAudit, resetAudit };
}
