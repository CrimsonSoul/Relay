import type { RowComponentProps } from 'react-window';
import { ContactCard } from '../../components/ContactCard';
import { VirtualRowData } from './types';

// Not wrapped in React.memo: react-window already memoises whatever it is handed, with a
// comparator that understands its own `style`/`ariaAttributes` props. A MemoExoticComponent also
// widens the return type to ReactNode, which its `rowComponent` prop rejects.
export function VirtualRow({
  index,
  style,
  ariaAttributes,
  ...data
}: RowComponentProps<VirtualRowData>) {
  const { log, contactMap, groupMap, onContextMenu } = data;
  const entry = log[index];
  if (!entry) return null;
  const { email, source } = entry;
  const contact = contactMap.get(email.toLowerCase());
  const name = contact ? contact.name : (email.split('@')[0] ?? email);
  const title = contact?.title;
  const phone = contact?.phone;
  const membership = groupMap.get(email.toLowerCase()) || [];

  // The positioned wrapper carries the list-item semantics react-window gives each row, so the
  // list's role="list" has the listitem children assistive technology expects.
  return (
    <div style={style} {...ariaAttributes}>
      <ContactCard
        key={email}
        recordKey={email}
        name={name}
        email={email}
        title={title}
        phone={phone}
        groups={membership}
        onContextMenu={(e) => onContextMenu(e, email, !contact)}
        sourceLabel={source === 'manual' ? 'Manual' : undefined}
      />
    </div>
  );
}
