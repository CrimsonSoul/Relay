/// <reference path="../../../pb_data/types.d.ts" />
/* global $apis, $security, ApiError, BadRequestError, ForbiddenError, DynamicModel, Record, RecordUpsertForm, routerAdd, onRecordEnrich, onRecordCreateRequest */

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

// Queue workers need the transient signed body; account-only reads never do.
onRecordEnrich((e) => {
  if (e.requestInfo?.auth?.isSuperuser()) e.record.unhide('payload');
  else e.record.hide('payload');
  e.next();
}, 'relay_privileged_commands');

// Validate uploaded bytes before PocketBase stores the file, including batch requests.
onRecordCreateRequest((e) => {
  const record = e.record;
  const upload = e.app.findRecordById('knowledge_uploads', record.getString('uploadId'));
  const batch = e.app.findRecordById('knowledge_upload_batches', record.getString('batchId'));
  const index = record.getFloat('index');
  const chunkCount = upload.getInt('chunkCount');
  const chunkSize = upload.getInt('chunkSize');
  const byteSize = upload.getInt('byteSize');
  const expectedBytes = Math.min(chunkSize, byteSize - index * chunkSize);
  const files = record.getUnsavedFiles('chunk');
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= chunkCount ||
    chunkSize !== 4 * 1024 * 1024 ||
    chunkCount !== Math.ceil(byteSize / chunkSize) ||
    expectedBytes <= 0 ||
    record.getFloat('byteSize') !== expectedBytes ||
    files.length !== 1 ||
    files[0].size !== expectedBytes ||
    upload.getString('state') !== 'uploading' ||
    batch.getString('state') !== 'active' ||
    upload.getString('batchId') !== batch.id ||
    upload.getString('accountId') !== record.getString('accountId') ||
    upload.getString('deviceId') !== record.getString('deviceId') ||
    batch.getString('accountId') !== record.getString('accountId') ||
    (!e.hasSuperuserAuth() &&
      (e.auth?.collection().name !== 'relay_privileged_accounts' ||
        !e.auth.getBool('active') ||
        e.auth.id !== record.getString('accountId')))
  )
    throw new BadRequestError('Invalid upload chunk.');
  e.next();
}, 'knowledge_upload_chunks');

// Hidden fields are omitted from non-superuser form loading. Accept the submitted
// signed body explicitly while keeping it hidden in every account response.
onRecordCreateRequest((e) => {
  const input = new DynamicModel({ payload: {} });
  e.bindBody(input);
  const payload = input.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new BadRequestError('Invalid command payload.');
  e.record.set('payload', payload);
  e.next();
}, 'relay_privileged_commands');

// Servers import uses ordinary caller permissions, with reviewed record preconditions
// enforced in the same transaction as each bounded batch of writes.
routerAdd(
  'POST',
  '/api/relay/servers/sync',
  (e) => {
    const operations = e.requestInfo().body.operations;
    const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) {
      throw new BadRequestError('Invalid Servers sync batch.');
    }
    const compareKeys = ([a], [b]) => {
      if (a === b) return 0;
      return a < b ? -1 : 1;
    };
    const canonical = (record) =>
      JSON.stringify(
        Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'expand')),
        (_key, value) =>
          object(value) ? Object.fromEntries(Object.entries(value).sort(compareKeys)) : value,
      );
    const validateOperation = (operation) => {
      if (!object(operation) || !['create', 'update', 'delete'].includes(operation.action)) {
        throw new BadRequestError('Invalid Servers sync operation.');
      }
      if (
        (operation.action !== 'delete' && !object(operation.data)) ||
        (operation.action === 'delete' && operation.data !== undefined)
      ) {
        throw new BadRequestError('Invalid Servers sync fields.');
      }
      if (operation.action === 'create') return;
      if (
        typeof operation.recordId !== 'string' ||
        !/^[a-z0-9]{15}$/.test(operation.recordId) ||
        !object(operation.expected) ||
        operation.expected.id !== operation.recordId ||
        typeof operation.expected.updated !== 'string'
      ) {
        throw new BadRequestError('Invalid Servers sync precondition.');
      }
    };
    for (const operation of operations) validateOperation(operation);
    const reviewedRecord = (transaction, collection, operation, seen) => {
      if (operation.action === 'create') return new Record(collection);
      if (seen.has(operation.recordId)) throw new BadRequestError('Duplicate Servers sync target.');
      seen.add(operation.recordId);
      const records = transaction.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, {
        id: operation.recordId,
      });
      const record = records[0];
      if (!record) throw new ApiError(409, 'The Servers list changed after the preview.');
      const current = JSON.parse(toString(record.marshalJSON()));
      if (canonical(current) !== canonical(operation.expected)) {
        throw new ApiError(409, 'The Servers list changed after the preview.');
      }
      return record;
    };
    const normalizedFields = (record, collection, operation) => {
      const data = record.replaceModifiers(operation.data || {});
      for (const field of collection.fields) {
        if (field.getHidden()) delete data[field.getName()];
      }
      for (const key of ['id', 'created', 'updated', 'collectionId', 'collectionName'])
        delete data[key];
      return data;
    };
    const writeOperation = (transaction, collection, operation, seen) => {
      const rule = {
        create: collection.createRule,
        update: collection.updateRule,
        delete: collection.deleteRule,
      }[operation.action];
      if (rule === null) throw new ForbiddenError();
      const record = reviewedRecord(transaction, collection, operation, seen);
      const data = normalizedFields(record, collection, operation);
      const info = e.requestInfo().clone();
      info.body = data;
      info.method = { create: 'POST', update: 'PATCH', delete: 'DELETE' }[operation.action];
      if (operation.action === 'create') record.load(data);
      if (operation.action !== 'create' && !transaction.canAccessRecord(record, info, rule))
        throw new ForbiddenError();
      if (operation.action === 'delete') {
        transaction.delete(record);
        return { status: 204, body: null };
      }
      const form = new RecordUpsertForm(transaction, record);
      form.load(data);
      try {
        form.submit();
      } catch {
        throw new BadRequestError('The Servers import failed record validation.');
      }
      // Creation rules can query the record only once it exists. A rejection
      // still rolls back this entire transaction before records/events commit.
      if (operation.action === 'create' && !transaction.canAccessRecord(record, info, rule))
        throw new ForbiddenError();
      return { status: 200, body: JSON.parse(toString(record.marshalJSON())) };
    };
    const results = [];
    e.app.runInTransaction((transaction) => {
      const collection = transaction.findCollectionByNameOrId('servers');
      if (collection.type !== 'base') throw new ForbiddenError();
      const seen = new Set();
      for (const operation of operations)
        results.push(writeOperation(transaction, collection, operation, seen));
    });
    return e.json(200, results);
  },
  $apis.requireAuth(),
  $apis.bodyLimit(4 * 1024 * 1024),
);

// Select and remove retained alert history in one transaction so an acknowledged
// pin is evaluated by the same database transaction that makes the deletion.
routerAdd(
  'POST',
  '/api/relay/retention/alert-history',
  (e) => {
    if (!e.auth || e.auth.collection().name !== '_superusers') throw new ForbiddenError();
    let deleted = 0;
    e.app.runInTransaction((transaction) => {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ');
      const expired = transaction.findRecordsByFilter(
        'alert_history',
        'pinned = false && created < {:cutoff}',
        '',
        0,
        0,
        { cutoff },
      );
      for (const record of expired) {
        transaction.delete(record);
        deleted += 1;
      }
      const unpinned = transaction.findRecordsByFilter(
        'alert_history',
        'pinned = false',
        '-created,-id',
        0,
        0,
      );
      for (const record of unpinned.slice(50)) {
        transaction.delete(record);
        deleted += 1;
      }
      const pinned = transaction.findRecordsByFilter(
        'alert_history',
        'pinned = true',
        '-created,-id',
        0,
        0,
      );
      for (const record of pinned.slice(100)) {
        transaction.delete(record);
        deleted += 1;
      }
    });
    return e.json(200, { deleted });
  },
  $apis.requireAuth(),
);
