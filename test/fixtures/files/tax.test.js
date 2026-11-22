import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { tax } from './shop.js';

if (process.env.RS_FIXTURE_LOG) appendFileSync(process.env.RS_FIXTURE_LOG, 'run\n');

test('tax', () => assert.ok(tax(1000) !== null));
