import test from 'node:test';
import assert from 'node:assert/strict';

test('portal password: sign-in cookie works, forged or expired ones do not', async () => {
  process.env.PORTAL_PASSWORD = 'office-secret';
  const { isSignedIn, checkPassword, signInCookie } = await import('../auth.js');
  assert.equal(checkPassword('office-secret'), true);
  assert.equal(checkPassword('wrong'), false);
  const cookie = signInCookie().split(';')[0];
  assert.equal(isSignedIn({ headers: { cookie } }), true);
  assert.equal(isSignedIn({ headers: { cookie: cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) } }), false);
  assert.equal(isSignedIn({ headers: { cookie: `mq_auth=1000.${'a'.repeat(64)}` } }), false);
  assert.equal(isSignedIn({ headers: {} }), false);
  delete process.env.PORTAL_PASSWORD;
  assert.equal(isSignedIn({ headers: {} }), true);
});
