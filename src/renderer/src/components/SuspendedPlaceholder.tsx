import React from 'react';
import { TactileButton } from '../components/TactileButton';

interface SuspendedPlaceholderProps {
  service: string;
  onWakeUp: () => void;
}

export const SuspendedPlaceholder: React.FC<SuspendedPlaceholderProps> = ({
  service,
  onWakeUp,
}) => (
  <div className="suspended-placeholder">
    <div className="suspended-placeholder-emoji">💤</div>
    <div className="suspended-placeholder-message">{service} is sleeping to save power</div>
    <TactileButton variant="primary" onClick={onWakeUp}>
      WAKE UP
    </TactileButton>
  </div>
);
