import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('browser patch carries Mu-Linux 0.97.45 SecureLink and protocol 13', () => {
  const patch = read('browser-online.patch');
  assert.match(patch, /SecureChannel\.cpp/);
  assert.match(patch, /crypto\/monocypher\.c/);
  assert.match(patch, /MU_PROTOCOL_VERSION = 13/);
  assert.match(patch, /ClientVersion\[\].*0\.97\.40/);
  assert.match(patch, /kServerIdentity/);
});

test('bounded build explicitly compiles and links the security sources', () => {
  const compile = read('deploy/build-client/compile.py');
  const link = read('deploy/build-client/link.py');
  for (const source of ['browser/SecureChannel.cpp', 'browser/crypto/monocypher.c']) {
    assert.ok(compile.includes(source), `${source} missing from compile plan`);
    assert.ok(link.includes(source), `${source} missing from runtime link plan`);
  }
});
