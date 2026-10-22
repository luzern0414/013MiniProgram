import test from 'node:test';
import assert from 'node:assert/strict';
import { summariesMatch } from '../../scripts/backup-summary.mjs';

const summary = definition => ({schemas: {development: {counts: {Example: '1'}}}, constraints: [{schema: 'development', table: 'Example', name: 'bounds', type: 'c', validated: true, definition}]});
const flat = 'CHECK (((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0)))';
const nested = 'CHECK ((((sort >= 0) AND (sort <= 100000)) AND ("minSelections" >= 0)))';

test('only AND association is normalized, in either legacy manifest direction', () => {
  assert.equal(summariesMatch(summary(flat), summary(nested)), true);
  assert.equal(summariesMatch(summary(nested), summary(flat)), true);
  assert.equal(summariesMatch(summary('CHECK ((value = ANY (ARRAY[1, 2])))'), summary('CHECK ((value = ANY (ARRAY[1, 2])))')), true);
});

test('non-PostgreSQL Unicode whitespace cannot disappear from an identifier', () => {
  for (const character of ['\u00a0', '\u1680', '\u2000', '\u2003', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
    const changed = nested.replace('sort', 'sort' + character);
    assert.equal(summariesMatch(summary(flat), summary(changed)), false, 'U+' + character.codePointAt(0).toString(16));
  }
});

test('PostgreSQL ASCII whitespace is accepted and quoted Unicode identity is preserved', () => {
  for (const character of [' ', '\t', '\n', '\r', '\f', '\v']) {
    assert.equal(summariesMatch(summary(flat), summary(nested.replaceAll(' ', character))), true);
  }
  const quoted = flat.replaceAll('sort', '"sort\u00a0"');
  assert.equal(summariesMatch(summary(quoted), summary(nested.replaceAll('sort', '"sort\u00a0"'))), true);
  assert.equal(summariesMatch(summary(quoted), summary(nested.replaceAll('sort', '"sort "'))), false);
  assert.equal(summariesMatch(summary(quoted), summary(nested)), false);
});

test('logical changes and unsupported mismatched CHECK syntax fail closed', () => {
  for (const changed of [
    nested.replace('AND', 'OR'), nested.replace('CHECK (', 'CHECK (NOT '),
    nested.replace('>= 0', '> 0'), nested.replace('100000', '100001'), nested.replace('sort', 'other'),
    'CHECK (((sort >= 0) OR ((sort <= 100000) AND ("minSelections" >= 0))))',
    nested + '; DROP TABLE "Example"; --', 'CHECK ((sort BETWEEN 0 AND 100000))',
    'CHECK ((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0)) NOT VALID',
    'CHECK ((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0)) /*comment*/',
    'CHECK ((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0) AND dangerous())',
    'CHECK (' + '('.repeat(10000) + 'sort >= 0' + ')'.repeat(10000) + ')',
  ]) assert.equal(summariesMatch(summary(flat), summary(changed)), false, changed.slice(0, 120));
});

test('constraint metadata, non-CHECK definitions and all summary fields remain exact', () => {
  for (const key of ['schema', 'table', 'name', 'type', 'validated']) {
    const expected = summary(nested);
    expected.constraints[0][key] = key === 'validated' ? false : 'other';
    assert.equal(summariesMatch(summary(flat), expected), false, key);
  }
  const actual = summary(flat), expected = summary(nested);
  actual.constraints[0].type = expected.constraints[0].type = 'f';
  assert.equal(summariesMatch(actual, expected), false);
  for (const mutate of [
    s => { s.constraints = []; }, s => { s.schemas.development.counts.Example = '2'; },
    s => { s.extra = true; }, s => { s.constraints[0].extra = true; },
  ]) {
    const changed = summary(nested);
    mutate(changed);
    assert.equal(summariesMatch(summary(flat), changed), false);
  }
});
