import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { admin, studio, HttpError } from '../src/lib/security';

test('admin requires a signed Access token for the exact issuer, audience, expiration and allowed email', async () => {
  const keys = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const publicKey = await exportJWK(keys.publicKey);
  const issuer = 'https://admin-access-test.cloudflareaccess.com';
  const env = {
    ACCESS_TEAM_DOMAIN: 'admin-access-test.cloudflareaccess.com',
    ACCESS_AUD: 'apple-admin-test',
    ADMIN_EMAIL: 'owner@example.com',
    APP_ORIGIN: 'https://shop.example.com',
    DEMO_MODE: 'false',
  } as Env;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    assert.equal(String(url), issuer + '/cdn-cgi/access/certs');
    return new Response(
      JSON.stringify({ keys: [{ ...publicKey, kid: 'key-1', alg: 'RS256', use: 'sig' }] }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  async function token(
    email: string | undefined,
    opts: {
      issuer?: string;
      aud?: string;
      exp?: number;
      foreign?: boolean;
      noExpiration?: boolean;
    } = {},
  ) {
    const jwt = new SignJWT(email === undefined ? {} : { email })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(opts.issuer || issuer)
      .setAudience(opts.aud || env.ACCESS_AUD!)
      .setSubject('account-subject')
      .setIssuedAt();
    if (!opts.noExpiration) jwt.setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 600);
    return jwt.sign(opts.foreign ? foreign.privateKey : keys.privateKey);
  }
  function request(jwt = '') {
    return new Request('https://shop.example.com/admin', {
      headers: {
        'cf-access-jwt-assertion': jwt,
        'cf-access-authenticated-user-email': 'owner@example.com',
      },
    });
  }
  const rejected = (status: number) => (e: unknown) =>
    e instanceof HttpError && e.status === status;
  try {
    const valid = await token(' Owner@Example.Com ');
    assert.equal(await admin(env, request(valid)), 'owner@example.com');
    await assert.rejects(admin(env, request()), rejected(401));
    await assert.rejects(admin(env, request('unsigned.token.value')), rejected(401));
    await assert.rejects(
      admin(env, request(await token('owner@example.com', { foreign: true }))),
      rejected(401),
    );
    await assert.rejects(
      admin(
        env,
        request(
          await token('owner@example.com', { issuer: 'https://foreign.cloudflareaccess.com' }),
        ),
      ),
      rejected(401),
    );
    await assert.rejects(
      admin(env, request(await token('owner@example.com', { aud: 'other-app' }))),
      rejected(401),
    );
    await assert.rejects(
      admin(
        env,
        request(await token('owner@example.com', { exp: Math.floor(Date.now() / 1000) - 60 })),
      ),
      rejected(401),
    );
    await assert.rejects(
      admin(env, request(await token('owner@example.com', { noExpiration: true }))),
      rejected(401),
    );
    await assert.rejects(admin(env, request(await token('other@example.com'))), rejected(403));
    await assert.rejects(admin(env, request(await token(undefined))), rejected(403));
    await assert.rejects(admin({ ...env, ADMIN_EMAIL: undefined }, request(valid)), rejected(503));
    await assert.rejects(admin({ ...env, ADMIN_EMAIL: ' , ' }, request(valid)), rejected(503));
    // Several administrators may be listed; each still needs a valid signed token.
    const team = { ...env, ADMIN_EMAIL: 'owner@example.com, Staff@Example.com' };
    assert.equal(await admin(team, request(await token('staff@example.com'))), 'staff@example.com');
    assert.equal(await admin(team, request(valid)), 'owner@example.com');
    await assert.rejects(admin(team, request(await token('example.com'))), rejected(403));
    await assert.rejects(
      admin(team, request(await token('owner@example.com,staff@example.com'))),
      rejected(403),
    );
    await assert.rejects(admin({ ...env, ACCESS_AUD: undefined }, request(valid)), rejected(503));
    await assert.rejects(
      admin({ ...env, ACCESS_TEAM_DOMAIN: undefined }, request(valid)),
      rejected(503),
    );
    // Site settings use their own list: an operations admin cannot enter, and an unset list
    // closes the console instead of falling back to ADMIN_EMAIL.
    const staff = { ...env, ADMIN_EMAIL: 'owner@example.com,staff@example.com' } as Env;
    await assert.rejects(studio(staff, request(valid)), rejected(503));
    const owned = { ...staff, STUDIO_EMAIL: 'owner@example.com' } as Env;
    assert.equal(await studio(owned, request(valid)), 'owner@example.com');
    await assert.rejects(studio(owned, request(await token('staff@example.com'))), rejected(403));
    assert.equal(
      await admin(owned, request(await token('staff@example.com'))),
      'staff@example.com',
    );
  } finally {
    globalThis.fetch = original;
  }
});
