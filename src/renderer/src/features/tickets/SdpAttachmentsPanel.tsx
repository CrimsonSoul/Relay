import { useRef, useState } from 'react';
import { SDP_ATTACHMENT_MAX_BYTES, type SdpAttachment } from '@shared/sdpAttachments';
import type { SdpReview } from '@shared/sdpMutation';
import type { SdpAccountView } from '@shared/sdpAccount';
import { TactileButton } from '../../components/TactileButton';
import { Modal } from '../../components/Modal';
export function SdpAttachmentsPanel({
  id,
  files,
  enabled,
  onResult,
}: Readonly<{
  id: string;
  files: SdpAttachment[];
  enabled: boolean;
  onResult: (view: SdpAccountView) => void;
}>) {
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
    setMessage('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
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
      if (!result.success || !result.data?.review) throw new Error();
      setSize(file.size);
      setReview(result.data.review);
    } catch {
      setMessage('Could not prepare the attachment. Check the file, connection and permissions.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review || locked.current) return;
    locked.current = true;
    setBusy(true);
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data) throw new Error();
      setMessage(result.data.message ?? 'Check SDP for the upload result.');
      onResult(result.data);
    } catch {
      setMessage(
        'The result is uncertain. Check SDP before uploading again. Relay will not retry automatically.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function download(attachmentId: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
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
    }
  }
  function close() {
    if (!busy) {
      setReview(undefined);
      void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
    }
  }
  return (
    <section className="ticket-related" aria-label="Ticket attachments">
      <h4>Attachments</h4>
      {!files.length && <p>No attachments.</p>}
      {files.map((file) => (
        <div key={file.id} className="ticket-actions">
          <span>
            {file.name} · {Math.ceil(file.size / 1024)} KB
          </span>
          <TactileButton
            size="sm"
            disabled={!enabled || busy || file.size > SDP_ATTACHMENT_MAX_BYTES}
            onClick={() => void download(file.id)}
          >
            Save {file.name}
          </TactileButton>
        </div>
      ))}
      <label className="ticket-upload-label">
        Add attachment (up to 10 MB)
        <input
          type="file"
          disabled={!enabled || busy || !!review}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {message && <p role="status">{message}</p>}
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
                Confirm live change
              </TactileButton>
            </>
          }
        >
          <p>
            Upload {review.mutation.name} ({Math.ceil(size / 1024)} KB) to ticket {id} in SDP using
            your work account.
          </p>
          <p>
            The file becomes a ticket attachment and may be visible to the requester according to
            SDP permissions.
          </p>
        </Modal>
      )}
    </section>
  );
}
