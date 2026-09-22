import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  boolInt,
  compact,
  isoDate,
  optionalId,
  optionalNumber,
  parseOrThrow,
} from '../../src/lib/validate.js';

describe('isoDate', () => {
  it('приймає YYYY-MM-DD', () => {
    assert.equal(isoDate.parse('2026-08-03'), '2026-08-03');
  });

  it('відхиляє інші формати', () => {
    assert.throws(() => isoDate.parse('03.08.2026'));
    assert.throws(() => isoDate.parse('2026-8-3'));
    assert.throws(() => isoDate.parse('not a date'));
  });
});

describe('optionalNumber', () => {
  it('порожній рядок / null / undefined -> undefined', () => {
    assert.equal(optionalNumber.parse(''), undefined);
    assert.equal(optionalNumber.parse(null), undefined);
    assert.equal(optionalNumber.parse(undefined), undefined);
  });

  it('приймає невідʼємні числа (у т.ч. рядком)', () => {
    assert.equal(optionalNumber.parse('5.5'), 5.5);
    assert.equal(optionalNumber.parse(0), 0);
  });

  it('відхиляє відʼємні числа', () => {
    assert.throws(() => optionalNumber.parse(-1));
  });
});

describe('optionalId', () => {
  it('приймає додатні цілі', () => {
    assert.equal(optionalId.parse('42'), 42);
  });

  it('відхиляє 0, відʼємні та дробові', () => {
    assert.throws(() => optionalId.parse(0));
    assert.throws(() => optionalId.parse(-1));
    assert.throws(() => optionalId.parse(1.5));
  });

  it('порожній рядок -> undefined', () => {
    assert.equal(optionalId.parse(''), undefined);
  });
});

describe('boolInt', () => {
  it('boolean -> 0/1', () => {
    assert.equal(boolInt.parse(true), 1);
    assert.equal(boolInt.parse(false), 0);
  });

  it('рядкові "0"/"1" теж приймаються', () => {
    assert.equal(boolInt.parse('1'), 1);
    assert.equal(boolInt.parse('0'), 0);
  });

  it('відхиляє значення поза [0,1]', () => {
    assert.throws(() => boolInt.parse(2));
  });
});

describe('compact', () => {
  it('прибирає лише undefined, зберігає null і falsy значення', () => {
    assert.deepEqual(compact({ a: undefined, b: null, c: 0, d: '', e: 5 }), {
      b: null,
      c: 0,
      d: '',
      e: 5,
    });
  });
});

describe('parseOrThrow', () => {
  it('успішний парсинг повертає дані', () => {
    const schema = z.object({ name: z.string() });
    assert.deepEqual(parseOrThrow(schema, { name: 'x' }), { name: 'x' });
  });

  it('помилка валідації -> HttpError 422 з переліком полів', () => {
    const schema = z.object({ name: z.string().min(1, 'Обовʼязкове') });
    assert.throws(
      () => parseOrThrow(schema, { name: '' }),
      (err) => err.status === 422 && err.details[0].path === 'name' && err.details[0].message === 'Обовʼязкове',
    );
  });
});
