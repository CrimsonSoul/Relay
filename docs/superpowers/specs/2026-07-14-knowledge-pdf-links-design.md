# Knowledge Base PDF Link Navigation Design

**Date:** 2026-07-14

**Status:** Approved design; pending written-spec review

## Summary

Relay will make link annotations in Knowledge Base PDFs interactive without weakening the read-only document model. Links to another indexed PDF will open that document inside the Focus Reader. Web links will open in the operator's default system browser after passing a dedicated main-process safety policy.

PDF authors will use ordinary links created in Word, Acrobat, or another PDF-authoring tool. They will not need Relay-specific URLs, record IDs, client hostnames, or absolute server paths. Relay will treat any file path embedded by the authoring tool only as a document identifier and will never read that path from the operator's laptop.

This design supersedes the original Knowledge Base specification's external-link non-goal. Forms, attachments, embedded scripts, automatic navigation, and arbitrary local-file access remain out of scope.

## Goals

- Make ordinary cross-PDF hyperlinks easy to author and maintain.
- Open linked Knowledge Base PDFs inside Relay rather than in an external PDF viewer.
- Avoid dependence on an author's or operator's absolute filesystem path.
- Keep links working when a uniquely named PDF moves between categories.
- Support optional page fragments such as `#page=2`.
- Preserve same-document PDF destination links.
- Open operator-selected web links in the default system browser.
- Keep all navigation user-initiated, read-only, keyboard accessible, and visually consistent with the Focus Reader.
- Preserve Relay's renderer isolation, IPC validation, URL security, and LAN client/server behavior.

## Non-goals

- No in-app link authoring, editing, repair, or document management.
- No custom `relay-kb:` authoring syntax in the first release.
- No automatic link activation while opening or rendering a PDF.
- No local filesystem access based on an embedded `file:` URL.
- No embedded web browser, web preview, iframe, or remote page rendering inside Relay.
- No PDF forms, attachments, embedded JavaScript, launch actions, media actions, or executable actions.
- No fuzzy selection when multiple indexed documents have the same filename.
- No promise that a link survives renaming its target PDF.

## Authoring Model

The primary workflow is the normal **Insert link** action in Word or Acrobat. An author may select another PDF from their working folder, type a relative PDF reference, or use a link produced by an exported Word document.

Examples Relay will understand:

```text
Payment API Degradation Guide.pdf
../Platform operations/Payment API Degradation Guide.pdf
../Platform operations/Payment API Degradation Guide.pdf#page=2
file:///C:/Users/Author/Documents/Runbooks/Payment%20API%20Degradation%20Guide.pdf
```

The final example does not grant filesystem access. Relay extracts the PDF filename, compares it with indexed Knowledge Base metadata, and ignores the machine-specific directory.

Author guidance:

- Use a unique PDF filename whenever possible.
- Use a category-relative path only when duplicate filenames must be disambiguated.
- Use `#page=N` when the linked procedure starts on a specific page.
- Keep web links fully qualified with `https://` or `http://`.

## Link Classification

Relay will inspect link annotations only after a page is opened. Each annotation is classified into exactly one of these types:

1. **Same-document destination** — a native PDF destination or a fragment referring to the current PDF.
2. **Knowledge document link** — a relative path, absolute path, or `file:` URL whose path ends in `.pdf`.
3. **Web link** — an absolute `https:` or `http:` URL.
4. **Blocked link** — every other protocol or action, including `javascript:`, `data:`, `blob:`, `ftp:`, local launch actions, and malformed values.

Classification is deterministic and does not fetch, resolve, or probe the target.

## Cross-Document Resolution

The renderer resolves a Knowledge document link only against the metadata records it already received from the protected `knowledge_documents` collection.

Resolution steps:

1. Decode the URL path safely once, normalize Unicode, convert backslashes to forward slashes, and separate an optional `#page=N` fragment.
2. Extract the final `.pdf` filename. Do not expose or access the preceding absolute directory.
3. Compare the filename case-insensitively with indexed `fileName` values.
4. If exactly one indexed document matches, open it regardless of category or source directory.
5. If multiple documents match, resolve the authored relative path from the current document's category and compare it with normalized `sourceKey` values.
6. If exactly one source key matches, open it.
7. Otherwise, do not guess. Show a non-blocking `Linked guide not found` or `Multiple guides use this filename` message.

This makes links independent of a particular workstation or server path. Moving a uniquely named PDF between categories does not break the link. Renaming the PDF does break the link because the filename is the human-authored identifier.

An accepted page fragment is a base-10 integer from `1` through the target document's `pageCount`. Invalid or out-of-range fragments open page 1 and report no error. Query strings are ignored for internal PDF resolution.

## Same-Document Navigation

Native destinations remain within the current PDF.js document. Relay resolves the destination to a bounded page index and optional vertical coordinate, then uses the existing Focus Reader navigation path. The current-section label updates when the destination corresponds to an extracted outline node; otherwise it displays `Document section`.

Same-document navigation never invokes IPC or reloads the PDF bytes.

## Web Links and Security Boundary

Web links open in the default system browser, not inside Relay. Because the existing general `OPEN_EXTERNAL` handler intentionally accepts only a small provider allowlist, Knowledge links will use a dedicated typed IPC action rather than broadening every Relay surface.

The dedicated main-process handler will:

- accept only a bounded string submitted after an explicit operator click;
- parse the URL with the platform URL parser;
- allow only `https:` and `http:`;
- require a non-empty hostname;
- reject embedded usernames or passwords;
- reject control characters, malformed URLs, and oversized values;
- pass the validated URL to `shell.openExternal`;
- return a typed success/failure result; and
- rate-limit repeated requests through Relay's existing filesystem/external-action limiter.

The renderer cannot call `shell`, cannot navigate its own window, and cannot open a web link automatically. Redirect handling remains the responsibility of the operator's managed system browser.

`file:` is not an allowed external protocol. A `file:` link ending in `.pdf` may supply a filename for indexed-document matching, but Relay will never send it to `openPath`, `openExternal`, `fetch`, or a filesystem API.

## PDF Rendering and Interaction

Relay will not enable PDF.js's complete annotation UI because the Knowledge Base remains read-only and does not support forms or attachments. The Focus Reader will render a narrow link-annotation overlay for the current page:

- obtain display annotations from the active `PDFPageProxy`;
- retain only link annotations with a supported destination;
- transform each annotation rectangle through the current PDF viewport;
- render an accessible button over the linked PDF region; and
- cancel and replace the overlay whenever the page, scale, document, or active state changes.

Internal links call the Focus Reader's document/page navigation callbacks. Web links call the dedicated external-link IPC action. No raw annotation HTML is inserted into the DOM.

Visual behavior:

- preserve the PDF's authored appearance at rest;
- show a subtle accent underline or translucent focus ring on hover and keyboard focus;
- use an internal-guide cursor/label for PDF links;
- use an external-link indicator and `Opens in browser` accessible description for web links; and
- keep link hit targets aligned at every supported zoom level.

## Data Flow

```text
PDF page annotation
  -> renderer classifier
     -> same PDF destination -> current viewer page/position
     -> PDF filename/path -> indexed metadata resolver -> Focus Reader document/page
     -> HTTP(S) URL -> typed preload IPC -> main-process validation -> system browser
     -> unsupported value -> blocked-link message
```

No collection schema change is required. Link targets are read from PDF annotations at view time and are not persisted in PocketBase or the offline metadata cache.

## Error Handling

- Missing unique PDF target: `Linked guide not found.`
- Duplicate filename without a usable relative path: `Multiple guides use this filename. Ask the document owner to qualify the category.`
- Blocked or malformed link: `Relay blocked an unsupported document link.`
- External browser open failure: `Relay could not open this website in the system browser.`
- Invalid page fragment: open the resolved document at page 1.

Errors are announced through the existing non-blocking notification surface. The open PDF and category drawer remain usable.

## Accessibility and Keyboard Behavior

- Every overlay target is reachable by keyboard in page reading order.
- Internal links expose the linked document name and optional page.
- Web links expose the destination host and state that they open in the browser.
- Enter and Space activate focused link overlays.
- Focus returns to the document viewer after cross-document navigation.
- Visible focus meets Relay's existing contrast and accent rules.
- A blocked link is not focusable when Relay cannot determine a safe action.

## Testing

### Pure resolver tests

- unique filename resolution across categories;
- category move with unchanged unique filename;
- duplicate filename disambiguation by relative source path;
- Windows backslashes and URL-encoded spaces;
- absolute Windows, POSIX, and `file:` paths reduced to metadata-only identifiers;
- valid, invalid, and out-of-range page fragments;
- renamed or missing target;
- traversal text that cannot escape indexed metadata; and
- blocked non-PDF file targets.

### Viewer tests

- link rectangles remain aligned after zoom and page changes;
- same-document destinations navigate without reloading bytes;
- a cross-PDF link selects the expected indexed document and page;
- external links call only the typed preload action;
- blocked schemes never invoke IPC;
- cancellation during page/link-layer replacement produces no unhandled rejection; and
- keyboard focus and accessible labels remain correct.

### Main-process and IPC tests

- valid HTTPS and HTTP URLs reach `shell.openExternal` only after validation;
- credentials, malformed values, control characters, oversized URLs, and unsupported schemes are rejected;
- trusted-sender and rate-limit checks remain enforced; and
- the broader general-purpose external URL policy remains unchanged.

### Integrated Electron test

Use local dummy PDFs containing:

- a same-document destination;
- a relative link to another category;
- an exported absolute `file:` link to a uniquely named indexed PDF;
- a page fragment; and
- an HTTPS link.

Verify the internal targets stay inside Relay, the web target is offered to the system browser through the mocked shell boundary, and no local authoring path is accessed.

## Documentation

Update the Knowledge Base administrator instructions with a short authoring section explaining unique filenames, normal Word/Acrobat links, optional page fragments, and the difference between internal PDF links and web links. Update the security document to record the dedicated external-link protocol and the rule that embedded file paths are metadata-only identifiers.

## Acceptance Criteria

- An author can create a normal link to another PDF without knowing a Relay record ID or server path.
- A client opens the uniquely named target inside Relay even when the PDF contains an absolute path from the author's computer.
- Moving a uniquely named target between categories does not break the link.
- Duplicate filenames are never resolved ambiguously.
- Same-document and optional page navigation work without leaving the Focus Reader.
- HTTPS and HTTP links open only in the default system browser after dedicated main-process validation.
- No PDF link can cause Relay to read an arbitrary local file, run an embedded action, or navigate the renderer to remote content.
- Link overlays are aligned, keyboard accessible, visually cohesive, and cancellation-safe.
- Existing client/server synchronization, offline PDF caching, and read-only permissions remain unchanged.
