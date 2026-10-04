import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TactileButton } from '../../components/TactileButton';
import { KnowledgeCategoryManager } from './KnowledgeCategoryManager';
import { EmptyPanel } from './management/knowledgeManagementShared';
import { KnowledgeDocumentsSection } from './management/KnowledgeDocumentsSection';
import { KnowledgeTrashSection } from './management/KnowledgeTrashSection';
import { KnowledgeUploadsSection } from './management/KnowledgeUploadsSection';
import { useKnowledgeManagement } from './useKnowledgeManagement';
import { getRelayRuntime } from '../../runtime/relayRuntime';
import { WebUploadRecovery } from './WebUploadRecovery';

type Section = 'documents' | 'categories' | 'uploads' | 'trash';

type WorkspaceProps = {
  onExit: () => void;
  onLibraryChanged?: () => void | Promise<void>;
  /** Opens the PDF picker on arrival, for entry points whose action is "add guides". */
  startWithUpload?: boolean;
};

export function KnowledgeManagementWorkspace({
  onExit,
  onLibraryChanged,
  startWithUpload = false,
}: Readonly<WorkspaceProps>) {
  const [query, setQuery] = useState('');
  const management = useKnowledgeManagement(onLibraryChanged, query);
  const [section, setSection] = useState<Section>('documents');
  const sectionRef = useRef<Section>('documents');
  const sectionContentRef = useRef<HTMLDivElement>(null);
  const sectionScrollPositionsRef = useRef<Record<Section, number>>({
    documents: 0,
    categories: 0,
    uploads: 0,
    trash: 0,
  });
  const focusSectionAfterChangeRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const snapshot = management.snapshot;
  const documents = useMemo(() => snapshot?.documents.items ?? [], [snapshot]);
  const trash = snapshot?.trash.items ?? [];
  const uploads =
    snapshot?.uploads.items.filter(({ state }) => state !== 'published' && state !== 'cancelled') ??
    [];
  const queueItems = management.uploadQueue.items.filter(
    ({ state }) => state !== 'published' && state !== 'cancelled',
  );
  const categories = snapshot?.categories ?? [];

  useLayoutEffect(() => {
    sectionRef.current = section;
    const content = sectionContentRef.current;
    if (!content) return;
    content.scrollTop = sectionScrollPositionsRef.current[section];
    if (focusSectionAfterChangeRef.current) {
      focusSectionAfterChangeRef.current = false;
      content.focus();
    }
  }, [section]);

  const openSection = (next: Section, focus = false) => {
    const currentSection = sectionRef.current;
    const content = sectionContentRef.current;
    if (content) sectionScrollPositionsRef.current[currentSection] = content.scrollTop;
    if (next === currentSection) {
      if (focus) content?.focus();
      return;
    }
    sectionRef.current = next;
    focusSectionAfterChangeRef.current = focus;
    setSection(next);
  };

  const selectSection = (next: Section) => {
    openSection(next, true);
    // Only Documents exposes the filter, and the snapshot it narrows is shared with every other
    // section, so leaving Documents releases it.
    if (next !== 'documents') setQuery('');
    setNotice(null);
  };

  const stagePdfs = async () => {
    const result = await management.stagePdfs();
    if (result.ok && result.uploads.length > 0) {
      openSection('uploads');
      setNotice(`${result.uploads.length} PDF${result.uploads.length === 1 ? '' : 's'} queued.`);
    }
  };

  // Once per mount: the click that opened the workspace asked for the picker.
  const startedUploadRef = useRef(false);
  useEffect(() => {
    if (!startWithUpload || startedUploadRef.current || !management.canManage) return;
    startedUploadRef.current = true;
    void stagePdfs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stagePdfs is recreated each render
  }, [startWithUpload, management.canManage]);

  const counts: Record<Section, number> = {
    documents: documents.length,
    categories: categories.length,
    uploads: new Set([
      ...uploads.map(({ id }) => id),
      ...queueItems.map((item) => item.uploadId ?? item.id),
    ]).size,
    trash: trash.length,
  };

  return (
    <div
      className={`knowledge-management ${
        management.canManage ? '' : 'knowledge-management--access-lost'
      }`.trim()}
    >
      <header className="knowledge-management__header">
        <h1>Manage Wiki</h1>
        <div className="knowledge-management__header-actions">
          <TactileButton size="sm" onClick={onExit}>
            Back to Wiki
          </TactileButton>
          {management.canManage && (
            <TactileButton
              size="sm"
              variant="primary"
              onClick={() => void stagePdfs()}
              loading={management.busy === 'upload'}
            >
              Add PDFs
            </TactileButton>
          )}
        </div>
      </header>

      {!management.canManage ? (
        <div className="knowledge-management__access-lost" role="alert">
          <h2>Publisher access ended</h2>
          <p>{management.error ?? 'Sign in again from Settings to continue managing the Wiki.'}</p>
        </div>
      ) : (
        <>
          {(management.error || notice) && (
            <div
              className={`knowledge-management__feedback ${management.error ? 'is-error' : ''}`}
              role={management.error ? 'alert' : 'status'}
            >
              <span>{management.error ?? notice}</span>
              <button
                type="button"
                onClick={() => {
                  management.clearError();
                  setNotice(null);
                }}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          {snapshot?.mode === 'recovery-required' && (
            <div className="knowledge-management__recovery" role="alert">
              The managed library needs server recovery before documents can be changed.
            </div>
          )}
        </>
      )}

      {management.canManage && getRelayRuntime().kind === 'web' && (
        <WebUploadRecovery
          uploading={management.busy === 'upload'}
          onRecovered={async () => {
            await management.refresh();
            openSection('uploads');
          }}
        />
      )}
      <div className="knowledge-management__workspace" hidden={!management.canManage}>
        <nav className="knowledge-management__rail" aria-label="Knowledge management">
          {(['documents', 'categories', 'uploads', 'trash'] as const).map((id) => (
            <button
              type="button"
              aria-current={section === id ? 'page' : undefined}
              aria-label={`${id[0]!.toUpperCase()}${id.slice(1)} ${counts[id]}`}
              className={section === id ? 'is-active' : ''}
              key={id}
              onClick={() => selectSection(id)}
            >
              <span>{`${id[0]!.toUpperCase()}${id.slice(1)}`}</span>
              <strong>{counts[id]}</strong>
            </button>
          ))}
        </nav>

        <div
          ref={sectionContentRef}
          className="knowledge-management__content"
          tabIndex={-1}
          aria-label={`${section[0]!.toUpperCase()}${section.slice(1)} management section`}
        >
          {!snapshot && (
            <EmptyPanel>
              {management.loading ? 'Loading managed library…' : 'Managed library unavailable.'}
            </EmptyPanel>
          )}

          <KnowledgeDocumentsSection
            active={Boolean(snapshot) && section === 'documents'}
            management={management}
            documents={documents}
            categories={categories}
            query={query}
            setQuery={setQuery}
            sectionContentRef={sectionContentRef}
            openUploads={(nextNotice) => {
              openSection('uploads');
              setNotice(nextNotice);
            }}
          />

          {snapshot && section === 'categories' && (
            <KnowledgeCategoryManager
              categories={categories}
              documents={[...documents, ...trash]}
              readCategoryDocuments={management.readCategoryDocuments}
              busy={management.busy}
              createCategory={management.createCategory}
              setCategoryName={management.setCategoryName}
              setCategoryOrder={management.setCategoryOrder}
              deleteCategory={management.deleteCategory}
            />
          )}

          <KnowledgeUploadsSection
            active={Boolean(snapshot) && section === 'uploads'}
            management={management}
            documents={documents}
            categories={categories}
            sectionContentRef={sectionContentRef}
          />

          <KnowledgeTrashSection
            active={Boolean(snapshot) && section === 'trash'}
            management={management}
            trash={trash}
          />
        </div>
      </div>
    </div>
  );
}
