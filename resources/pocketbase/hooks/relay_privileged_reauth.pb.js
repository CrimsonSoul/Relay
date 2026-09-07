/// <reference path="../../../pb_data/types.d.ts" />
/* global $apis, $security, ApiError, BadRequestError, ForbiddenError, DynamicModel, Record, RecordUpsertForm, routerAdd */

routerAdd(
  'POST',
  '/api/relay/privileged/reauth',
  (e) => {
    const accountCollection = 'relay_privileged_accounts';
    const stateCollection = 'relay_privileged_state';
    const deviceCollection = 'relay_privileged_devices';
    const commandCollection = 'relay_privileged_commands';
    const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
    const validIdentifier = (value, maximumLength) =>
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maximumLength &&
      identifierPattern.test(value);
    const reject = () => {
      throw new BadRequestError('Invalid reauthentication request.');
    };
    const input = new DynamicModel({
      password: '',
      requestId: '',
      deviceId: '',
    });
    e.bindBody(input);

    const account = e.auth;
    if (
      account?.collection().name !== accountCollection ||
      !account.getBool('active') ||
      typeof input.password !== 'string' ||
      input.password.length < 12 ||
      input.password.length > 128 ||
      !account.validatePassword(input.password) ||
      !validIdentifier(input.requestId, 128) ||
      !validIdentifier(input.deviceId, 200)
    ) {
      reject();
    }

    let authority;
    let device;
    try {
      authority = e.app.findFirstRecordByData(stateCollection, 'key', 'primary');
      device = e.app.findFirstRecordByFilter(
        deviceCollection,
        "accountId = {:accountId} && deviceId = {:deviceId} && state = 'active'",
        { accountId: account.id, deviceId: input.deviceId },
      );
    } catch {
      reject();
    }

    let role = '';
    if (account.id === authority.getString('ownerAccountId')) {
      role = 'owner';
    } else if (account.getString('storedRole') === 'administrator') {
      role = 'admin';
    } else if (account.id === authority.getString('publisherAccountId')) {
      role = 'publisher';
    }
    if (
      role === '' ||
      device.getString('accountId') !== account.id ||
      device.getString('deviceId') !== input.deviceId
    ) {
      reject();
    }

    const authenticatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    try {
      e.app.runInTransaction((transaction) => {
        const collection = transaction.findCollectionByNameOrId(commandCollection);
        const proof = new Record(collection);
        proof.load({
          requestId: input.requestId,
          accountId: account.id,
          deviceId: input.deviceId,
          operatorId: '',
          displayNameSnapshot: account.getString('displayName'),
          roleClaim: role,
          command: 'privileged.reauth.confirm',
          issuedAt: authenticatedAt,
          expiresAt,
          expectedRevision: 0,
          hasExpectedRevision: false,
          payload: { authenticatedAt },
          bodyHash: $security.sha256(
            `${input.requestId}\n${account.id}\n${input.deviceId}\n${authenticatedAt}`,
          ),
          signature: '',
          state: 'succeeded',
          result: {
            accountId: account.id,
            deviceId: input.deviceId,
            authenticatedAt,
          },
          safeError: '',
          completedAt: authenticatedAt,
          proofConsumedAt: '',
        });
        transaction.save(proof);
      });
    } catch {
      reject();
    }

    return e.json(200, {
      proofId: input.requestId,
      expiresAt,
    });
  },
  $apis.requireAuth('relay_privileged_accounts'),
  $apis.bodyLimit(4096),
);

// Keep server request handlers in this integrity-verified hook: its filename is
// part of the retained-runtime manifest used by existing Windows launchers.
// Ordinary CRUD stays on PocketBase's built-in routes. Only offline replay needs
// this transaction boundary; unsupported servers reject its route before writing.
routerAdd(
  'POST',
  '/api/relay/offline/replay',
  (e) => {
    const input = e.requestInfo().body;
    const allowedCollections = [
      'contacts',
      'servers',
      'oncall',
      'bridge_groups',
      'bridge_history',
      'alert_history',
      'alert_reminders',
      'notes',
      'oncall_dismissals',
      'oncall_board_settings',
      'dynatrace_problem_states',
      'dynatrace_problem_notes',
    ];
    if (
      !allowedCollections.includes(input.collection) ||
      !['update', 'delete'].includes(input.action) ||
      typeof input.recordId !== 'string' ||
      !/^[a-z0-9]{15}$/.test(input.recordId) ||
      typeof input.expectedUpdated !== 'string' ||
      input.expectedUpdated.length > 40 ||
      !Number.isFinite(Date.parse(input.expectedUpdated.replace(' ', 'T'))) ||
      typeof input.expectedFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.expectedFingerprint) ||
      (input.action === 'update' &&
        (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))) ||
      (input.action === 'delete' && input.data !== undefined)
    ) {
      throw new BadRequestError('Invalid offline replay request.');
    }

    e.app.runInTransaction((transaction) => {
      const collection = transaction.findCollectionByNameOrId(input.collection);
      const rule = input.action === 'update' ? collection.updateRule : collection.deleteRule;
      if (collection.type !== 'base' || rule === null) throw new ForbiddenError();
      const records = transaction.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, {
        id: input.recordId,
      });
      const record = records[0];
      if (!record) {
        if (input.action === 'delete') return;
        throw new ApiError(409, 'The server record changed. The offline change remains queued.');
      }
      const requestInfo = e.requestInfo().clone();
      // PocketBase evaluates update rules against resolved modifier values.
      const normalizedData = record.replaceModifiers(input.data || {});
      for (const field of collection.fields) {
        if (field.getHidden()) delete normalizedData[field.getName()];
      }
      requestInfo.body = normalizedData;
      requestInfo.method = input.action === 'update' ? 'PATCH' : 'DELETE';
      if (!transaction.canAccessRecord(record, requestInfo, rule)) throw new ForbiddenError();
      // Timestamps alone cannot distinguish writes within the same millisecond.
      // Materialize Go-backed date/JSON values as the plain JSON seen by the SDK.
      const snapshot = JSON.parse(toString(record.marshalJSON()));
      const canonical = JSON.stringify(snapshot, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => {
                if (a === b) return 0;
                return a < b ? -1 : 1;
              }),
            )
          : value,
      );
      if (
        record.getString('updated') !== input.expectedUpdated ||
        $security.sha256(canonical) !== input.expectedFingerprint
      ) {
        throw new ApiError(409, 'The server record changed. The offline change remains queued.');
      }
      if (input.action === 'delete') {
        transaction.delete(record);
      } else {
        const form = new RecordUpsertForm(transaction, record);
        form.load(normalizedData);
        try {
          form.submit();
        } catch {
          throw new BadRequestError('The offline change failed record validation.');
        }
      }
    });
    return e.json(200, { applied: true });
  },
  $apis.requireAuth(),
  $apis.bodyLimit(270336),
);
