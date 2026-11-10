import * as assert from 'node:assert/strict';
import {
  mobilePairingErrorMessage,
  mobilePairingErrorStatus,
} from '../main/lib/mobile-pairing-error';

const registrationPending = new Error('Cloud POS is not registered');
assert.equal(mobilePairingErrorStatus(registrationPending), 409);

const registrationMessage = mobilePairingErrorMessage(registrationPending);
assert.match(registrationMessage, /not registered with FloAdmin/i);
assert.match(registrationMessage, /internet connection/i);
assert.match(registrationMessage, /Cloud Services/i);
assert.match(registrationMessage, /Registration is automatic/i);
assert.match(registrationMessage, /no separate claim step is needed/i);
assert.doesNotMatch(registrationMessage, /Complete registration in FloAdmin/i);

const cloudUnavailable = new Error('Cloud service unavailable');
assert.equal(mobilePairingErrorStatus(cloudUnavailable), 502);
assert.equal(mobilePairingErrorMessage(cloudUnavailable), 'Cloud service unavailable');

assert.equal(mobilePairingErrorStatus(undefined), 502);
assert.equal(mobilePairingErrorMessage(undefined), 'Could not reach FloAdmin');
assert.equal(mobilePairingErrorMessage({ message: 42 }), 'Could not reach FloAdmin');

console.log('mobile-pairing-errors: all assertions passed');
