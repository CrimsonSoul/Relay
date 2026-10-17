/** Relay server settings that never travel over the network, shown under each server section. */
export function LocalOnlyNote() {
  return (
    <div className="administration-callout">
      <strong>Changed only on the Relay server PC</strong>
      <span>
        Connection paths, backups, restores, folder pickers, and executable selection are not
        available remotely.
      </span>
    </div>
  );
}
