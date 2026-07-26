/// <reference path="../../../pb_data/types.d.ts" />
/* global $apis, $security, BadRequestError, DynamicModel, Record, routerAdd */

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
      !account ||
      account.collection().name !== accountCollection ||
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
