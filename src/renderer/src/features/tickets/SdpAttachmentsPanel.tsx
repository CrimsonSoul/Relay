import { useId, useRef, useState } from 'react';
import { SDP_ATTACHMENT_MAX_BYTES, type SdpAttachment } from '@shared/sdpAttachments';
import type { SdpReview } from '@shared/sdpMutation';
import type { SdpAccountView } from '@shared/sdpAccount';
import { TactileButton } from '../../components/TactileButton';
import { Modal } from '../../components/Modal';
import { SdpIcon } from './SdpIcon';

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

export function SdpAttachmentsPanel({
  id,
  number = id,
  files,
  enabled,
  onResult,
}: Readonly<{
  id: string;
  number?: string;
  files: SdpAttachment[];
  enabled: boolean;
  onResult: (view: SdpAccountView) => void;
}>) {
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  const [activity, setActivity] = useState<string>();
  const [review, setReview] = useState<SdpReview>();
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  async function upload(file: File) {
    if (locked.current) return;
    if (!file.size || file.size > SDP_ATTACHMENT_MAX_BYTES) {
      setMessage('Choose a file between 1 byte and 10 MB.');
      return;
    }
    locked.current = true;
    setBusy(true);
    setActivity('prepare');
    setMessage('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCodePoint(...bytes.subarray(offset, offset + 8192));
      const result = await globalThis.api!.sdpAccount!({
        action: 'prepareChange',
        mutation: {
          kind: 'attachment',
          id,
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          data: btoa(binary),
        },
      });
      if (!result.success || !result.data?.review)
        throw new Error('SdpAttachmentsPanel: SDP operation did not return the expected result.');
      setSize(file.size);
      setReview(result.data.review);
    } catch {
      setMessage('Could not prepare the attachment. Check the file, connection and permissions.');
    } finally {
      locked.current = false;
      setBusy(false);
      setActivity(undefined);
    }
  }
  async function confirm() {
    if (!review || locked.current) return;
    locked.current = true;
    setBusy(true);
    setActivity('upload');
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data)
        throw new Error('SdpAttachmentsPanel: SDP operation did not return the expected result.');
      setMessage(result.data.message ?? 'Check SDP for the upload result.');
      onResult(result.data);
    } catch {
      setMessage(
        'The result is uncertain. Check SDP before uploading again. Relay will not retry automatically.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
      setActivity(undefined);
    }
  }
  async function download(attachmentId: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setActivity(attachmentId);
    setMessage('');
    try {
      const result = await globalThis.api!.sdpAccount!({
        action: 'downloadAttachment',
        id,
        attachmentId,
      });
      setMessage(
        result.success
          ? (result.data?.message ?? 'Download finished.')
          : 'The attachment could not be downloaded.',
      );
    } catch {
      setMessage('The attachment could not be downloaded. Check your connection and permissions.');
    } finally {
      locked.current = false;
      setBusy(false);
      setActivity(undefined);
    }
  }
  function close() {
    if (!busy) {
      setReview(undefined);
      void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
      requestAnimationFrame(() => uploadButton.current?.focus());
    }
  }
  let uploadLabel = 'Add attachment';
  if (activity === 'prepare') uploadLabel = 'Preparing…';
  if (activity === 'upload') uploadLabel = 'Uploading…';
  return (
    <section
      className="ticket-related sdp-attachments"
      aria-label="Ticket attachments"
      aria-busy={busy}
    >
      <div className="sdp-attachments__header">
        <h4>
          Attachments <span className="sdp-attachments__count">{files.length}</span>
        </h4>
        <TactileButton
          ref={uploadButton}
          size="sm"
          icon={<SdpIcon name="upload" />}
          loading={activity === 'prepare' || activity === 'upload'}
          disabled={!enabled || busy || !!review}
          aria-describedby={helpId}
          onClick={() => uploadInput.current?.click()}
        >
          {uploadLabel}
        </TactileButton>
        <input
          ref={uploadInput}
          type="file"
          hidden
          aria-label="Add attachment (up to 10 MB)"
          disabled={!enabled || busy || !!review}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
      <p id={helpId} className="ticket-mode-note">
        {enabled
          ? 'Up to 10 MB per file. Review before uploading.'
          : 'Reconnect to SDP to upload or save files.'}
      </p>
      {!files.length && <p className="sdp-attachments__empty">No attachments yet.</p>}
      {!!files.length && (
        <ul className="sdp-attachments__list" aria-label="Attached files">
          {files.map((file) => (
            <li key={file.id} className="sdp-attachment">
              <SdpIcon name="attachment" />
              <div className="sdp-attachment__info">
                <span className="sdp-attachment__name">{file.name}</span>
                <span className="ticket-mode-note">
                  {fileSize(file.size)}
                  {file.size > SDP_ATTACHMENT_MAX_BYTES && ' · Over the 10 MB download limit'}
                </span>
              </div>
              <TactileButton
                size="sm"
                variant="ghost"
                icon={<SdpIcon name="download" />}
                aria-label={`Save ${file.name}`}
                loading={activity === file.id}
                disabled={!enabled || busy || !!review || file.size > SDP_ATTACHMENT_MAX_BYTES}
                onClick={() => void download(file.id)}
              >
                {activity === file.id ? 'Saving…' : 'Save file'}
              </TactileButton>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="sdp-attachments__status">
          <output>{message}</output>
        </p>
      )}
      {review?.mutation.kind === 'attachment' && (
        <Modal
          dialogClassName="modal-dialog-generic sdp-ticket-dialog"
          isOpen
          title="Review attachment upload"
          onClose={close}
          footer={
            <>
              <TactileButton disabled={busy} onClick={close}>
                Cancel
              </TactileButton>
              <TactileButton
                variant="primary"
                disabled={busy || review.expiresAt <= Date.now()}
                onClick={() => void confirm()}
              >
                Upload attachment
              </TactileButton>
            </>
          }
        >
          <div className="sdp-attachment sdp-attachment--review">
            <SdpIcon name="attachment" />
            <div className="sdp-attachment__info">
              <strong className="sdp-attachment__name">{review.mutation.name}</strong>
              <span className="ticket-mode-note">
                {fileSize(size)} · Ticket {number}
              </span>
            </div>
          </div>
          <p>
            The file becomes a ticket attachment and may be visible to the requester according to
            SDP permissions.
          </p>
        </Modal>
      )}
    </section>
  );
}
