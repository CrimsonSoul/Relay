import { TactileButton } from '../TactileButton';
import {
  openNotificationPreferences,
  useNotifications,
} from '../../features/notifications/NotificationProvider';

/**
 * Points to the one place notification preferences live: the Notifications dialog, whose Tickets
 * controls share the running ticket monitor, so they are not rendered a second time here.
 */
export function NotificationSettings() {
  const notifications = useNotifications();
  const preferences = notifications?.preferences;
  const channels = preferences
    ? [
        preferences.toast && 'in-app banners',
        preferences.desktop && 'desktop notifications',
        preferences.sound && 'sounds',
      ].filter(Boolean)
    : [];
  return (
    <section className="settings-section" aria-labelledby="settings-notifications-title">
      <h2 id="settings-notifications-title" className="settings-section-heading">
        Notifications
      </h2>
      <p className="settings-description">
        Delivery, quiet hours and which Tickets, Problems, Radar and Status alerts reach you. They
        stay on this device.
      </p>
      {preferences && (
        <p className="settings-description">
          {channels.length ? `On: ${channels.join(', ')}.` : 'All delivery is off.'}
          {preferences.quietHoursEnabled &&
            ` Quiet hours ${preferences.quietStart}–${preferences.quietEnd}.`}
        </p>
      )}
      <div className="settings-button-row">
        <TactileButton size="sm" onClick={openNotificationPreferences}>
          Open Notification Preferences
        </TactileButton>
      </div>
    </section>
  );
}
