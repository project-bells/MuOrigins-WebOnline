import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('auto attack waits for runtime, toggles native mode and stops on focus loss', () => {
  const elements = [], events = {}, calls = [];
  const canvas = {before(){},focus(){}};
  const module = {canvas, _mu_auto_attack:v=>calls.push(v), _mu_get_auto_attack:()=>0};
  const document = {
    createElement(){const e={style:{},setAttribute(){},append(){},addEventListener(n,f){this[n]=f;}};elements.push(e);return e;},
    addEventListener(n,f){events[n]=f;}
  };
  const context = {Module:module, document, window:{addEventListener(n,f){events[n]=f;}}};
  vm.runInNewContext(readFileSync(new URL('../browser-auto-attack.js', import.meta.url),'utf8'), context);
  const button = elements[1];
  assert.equal(button.disabled, true);
  button.click(); assert.deepEqual(calls, []);
  module.onRuntimeInitialized(); assert.equal(button.disabled, false);
  button.click(); assert.deepEqual(calls, [1]);
  events.blur(); assert.deepEqual(calls, [1,0]);
  button.click(); events.keydown({key:'Escape'}); assert.deepEqual(calls, [1,0,1,0]);
});
