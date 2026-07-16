# Knowledge Base Administration

Relay keeps the Knowledge Base read-only for ordinary operators. An administrator designates one existing operator as the publisher. That operator can manage the library from the Relay server or from their paired work laptop. PocketBase on the Relay server is the only document authority; there is no watched or shared source folder to maintain.

## Assign the publisher

1. Sign in to Relay as an administrator.
2. Open **Settings**, then **Administration** and **Publisher**.
3. Select an active operator and confirm the publisher change with the administrator password.
4. Have that operator sign in on their assigned laptop.

The publisher receives access to **Manage library** in the Knowledge tab. Changing the assignment removes management access from the previous publisher. Administrators retain full access.

## Publish documents

1. Open **Knowledge Base** and choose **Manage library**.
2. Select up to 100 PDF files from the current computer.
3. Leave Relay open while the upload queue transfers, validates, and indexes the files.
4. Review the title and category, then publish each ready file.

Categories are created and assigned in Relay. They are not pulled from the PDF header or from an author's local folder path. A published document's display title and category can be changed later without replacing its PDF.

Relay accepts PDFs no larger than 50 MiB or 1,000 pages. Upload batches are transferred in 4 MiB chunks with at most two chunks in flight at once. Relay retries temporary VPN or server failures with bounded backoff, then leaves the batch in **Waiting for network** so the publisher can resume it. Already acknowledged chunks are not sent again.

The queue survives an app restart when the operating system's encrypted storage is available. Relay encrypts the selected source path, revalidates the file before reading every chunk, and never exposes the path or PDF bytes to the renderer. If the file moved or changed, choose **Reselect PDF** and select the same unchanged file. When encrypted storage is unavailable, Relay keeps the queue only in memory rather than writing a plaintext path.

An unpublished server upload expires after seven days. Validation failures remain unpublished with a safe reason for the publisher. Publishing copies the validated PDF into the managed document record and immediately clears the temporary staged PDF; cleanup later removes the expired upload record.

## Replace, recover, and delete

- **Replace existing** appears when an uploaded filename already exists. It updates that document's contents while preserving its managed library identity and authored filename, so existing relative links continue to resolve.
- **Pause all** and **Resume all** control an active batch without discarding acknowledged chunks.
- **Cancel batch** requires confirmation and removes incomplete server chunks and temporary staged data.
- **Move to trash** removes the document from the reader without permanently deleting it.
- **Restore** returns a trashed document to the library.
- **Delete permanently** requires the signed-in administrator or publisher to re-enter their password. This cannot be undone through the management workspace.

Relay does not automatically purge the trash. Management audit events are retained for 365 days. Server backups include the managed Knowledge Base records and protected PDF files; a restored server restart reconciles the managed library before clients reconnect.

## Link from one PDF to another

Create an ordinary file link in Word, Acrobat, or the PDF authoring tool. Use a relative target rather than a path tied to the author's computer.

```text
Other Guide.pdf
Other Guide.pdf#page=3
../Network/Edge Response.pdf#page=3
```

- `Other Guide.pdf` opens that document at its first page.
- `#page=3` opens page 3.
- `../Category/Document.pdf` disambiguates duplicate filenames by category.
- HTTPS links open in the operator's managed system browser.

Unique filenames are recommended. Relay resolves links from managed document metadata and never reads the author's original directory from an operator's laptop. If a document's authored filename changes, update links that point to the old filename.

## Offline behavior

Operators can continue reading documents already cached on their laptop when Relay is disconnected from the server. Knowledge Base management is intentionally unavailable offline: uploads, edits, trash actions, and permission changes must reach the server so that every client receives one authoritative result. An interrupted upload remains recoverable, but it cannot make progress until Relay can reach the server again.
