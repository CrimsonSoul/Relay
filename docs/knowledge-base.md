# Wiki administration

Knowledge is Relay's shared reference workspace, and Wiki is its managed PDF library. Wiki is read-only during ordinary Relay use. An Owner or Administrator creates and assigns the single protected Publisher account. Owner, Administrator, and assigned Publisher sessions can manage Wiki from the Relay server, a paired Relay Desktop client, or Relay Web. PocketBase on the Relay server is the only document authority; there is no watched or shared source folder to maintain.

## Assign the publisher

1. Sign in with an Owner or Administrator account.
2. Open **Settings → Administration → Accounts & roles**.
3. If no Publisher account exists, choose **Add Publisher** and provide its username and display name. Relay creates and assigns that account with credential setup still required.
4. If a retained Publisher account already exists, select it under **Publisher assignment** and choose **Assign Publisher** or **Replace Publisher**. Confirm with protected reauthentication. Assignment invalidates its previous credential and returns it to **SETUP NEEDED**.
5. On the Relay server PC, choose the assigned account under credential setup, enter and confirm its new password, and choose **Set credential**.
6. On a paired Relay Desktop client, sign in with that Publisher account. Relay Web can use the account without desktop pairing but must remain on the trusted LAN or VPN.

The assigned account receives access to **Manage Wiki**. Changing the assignment removes management access from the previous Publisher. Owners and Administrators retain management access.

## Publish documents

1. Open **Knowledge → Wiki → Manage Wiki**.
2. Select up to 100 PDF files from the current computer. Each file must be no larger than 50 MiB or 1,000 pages.
3. Leave Relay open while the upload queue transfers, validates, and indexes the files.
4. Review the display title, category, and document type (**SOP Manual** or **Quick Guide**), then publish each ready file.

Categories are created and assigned in Relay. They are not pulled from the PDF header or from an author's local folder path. A published document's display title, category, and document type (**SOP Manual** or **Quick Guide**) can be changed later without replacing its PDF.

## Organize the Wiki

The Wiki landing page automatically spotlights recently updated material, presents SOP Manuals as cover-led category shelves, and keeps Quick Guides in compact rows. Recently Updated is derived from document timestamps and needs no manual featured-list maintenance.

Owner, Administrator, and Publisher accounts can open **Manage Wiki**, then **Categories**, to add, rename, or reorder categories. Deleting a category requires choosing where all of its documents will move. The built-in fallback category can be renamed or reordered but cannot be deleted. In **Documents**, managers can edit a document's title, category, and type together or select multiple documents for one bulk category move.

Relay requires every active Wiki document to have a unique authored filename. Publication is rejected when another active document already uses that filename. Display titles do not need to be unique.

## Download a document

Every authenticated Wiki reader can download the open PDF from the reader toolbar. Relay downloads one document at a time only after an operator selects **Download**; it does not start automatic or bulk downloads.

Relay Desktop opens a **Save As** dialog using the document's authored filename. The saved bytes pass through the same signature, size, and checksum checks as the reader, and an already verified desktop cache can supply the file while offline. Cancelling the dialog does not fetch or write a file.

Relay Web uses the browser's normal download flow with the authored filename. The browser fetch stays on Relay's authenticated, same-origin PDF route and therefore requires an active online session.

## Upload queue and retention

Relay resumes acknowledged upload work after temporary network or server failures instead of restarting the batch. **Pause all** preserves progress until **Resume all** is selected. **Discard upload** and **Cancel batch** remove incomplete server data once Relay can reconnect.

On Relay Desktop, the queue survives an app restart when operating-system encrypted storage is available. Work interrupted by sign-out or shutdown resumes when the same Publisher returns. If a source file moved, choose **Reselect PDF** and select the same unchanged file. When encrypted storage is unavailable, Relay keeps the queue only in memory.

In Relay Web, the queue belongs to the current browser/server session rather than persistent desktop storage. Do not rely on it across session expiry or a Relay server restart. The browser cannot reselect a lost source file; start a new batch if its source becomes unavailable.

Unpublished server uploads expire after seven days. Validation failures remain unpublished with a safe reason for the Publisher. Publishing moves the validated PDF into the managed library and clears its temporary staging data.

## Replace, recover, and delete

- **Replace PDF** starts a staged replacement from an existing document. When that upload is ready, **Replace existing** updates the document's contents while preserving its managed identity, authored filename, display title, category, and type.
- **Pause all** and **Resume all** control an active batch without discarding acknowledged chunks.
- **Discard upload** stops local transfer, preserves the request across a temporary disconnect or restart, and removes incomplete server data after confirmation.
- **Cancel batch** requires confirmation and removes incomplete server chunks and temporary staged data.
- **Trash** removes the document from the reader without permanently deleting it.
- **Restore** returns a trashed document to the library.
- **Delete permanently** requires the signed-in Owner, Administrator, or Publisher to re-enter their password. This cannot be undone through the management workspace.

Relay does not automatically purge the trash. Server backups include managed Wiki records and protected PDFs; local document caches and upload queues are disposable and are not restore sources.

## Link from one PDF to another

Create an ordinary file link in Word, Acrobat, or the PDF authoring tool. Link to the target's unique authored filename and append an optional, one-based `#page=N` fragment.

```text
Other Guide.pdf
Other Guide.pdf#page=3
```

- `Other Guide.pdf` opens that document at its first page.
- `#page=3` opens page 3.
- HTTP and HTTPS links open in the operator's managed system browser.

Relay resolves file links from managed document metadata and never reads the author's original directory from an operator's computer. The authored filename is fixed after publication; **Replace PDF** preserves it.

### Migrated libraries with duplicate filenames

Relative category paths are retained only to disambiguate duplicate filenames in migrated libraries:

```text
../Network/Edge Response.pdf#page=3
```

New publications must satisfy the unique-filename rule, so new authoring should use the filename-only form.

## Offline behavior

Relay Desktop operators can continue reading documents already cached on their computer when Relay is disconnected from the server. Relay Web is online-only and has no offline document cache. Wiki management is intentionally unavailable offline: uploads, edits, trash actions, and permission changes must reach the server so that every client receives one authoritative result. An interrupted desktop upload remains recoverable, but it cannot make progress until Relay can reach the server again.
