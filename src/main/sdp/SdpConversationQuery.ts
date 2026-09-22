/** SDP's Emails filter excludes notes, approval comments, and system-user notifications.
 * Filter before paging: notification type or sender display name cannot identify automation.
 */
export function emailConversationCriteria(includeAutoNotifications = false) {
  return {
    field: 'type',
    condition: 'neq',
    values: ['NOTES'],
    children: [
      ...(!includeAutoNotifications
        ? [
            {
              field: 'created_by.user_type',
              condition: 'neq',
              values: ['1'],
              logical_operator: 'and',
            },
          ]
        : []),
      { field: 'type', condition: 'neq', values: ['ApprovalComments'], logical_operator: 'and' },
    ],
  };
}
