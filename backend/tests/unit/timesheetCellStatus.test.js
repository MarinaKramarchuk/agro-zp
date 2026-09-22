import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestApp } from '../helpers/testApp.js';

// timesheetService.js імпортує db/index.js на верхньому рівні — динамічний
// імпорт після createTestApp(), як і в tariffService.test.js.
let cellStatus;

describe('timesheetService.cellStatus', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
    ({ cellStatus } = await import('../../src/services/timesheetService.js'));
  });

  after(async () => {
    await ctx.close();
  });

  it('0 записів -> empty (сірий), незалежно від годин', () => {
    assert.equal(cellStatus(0, 0), 'empty');
    assert.equal(cellStatus(5, 0), 'empty');
  });

  it('є запис, але 0 годин -> no_hours', () => {
    assert.equal(cellStatus(0, 1), 'no_hours');
  });

  it('1..8 годин -> normal (зелений)', () => {
    assert.equal(cellStatus(1, 1), 'normal');
    assert.equal(cellStatus(8, 1), 'normal'); // межа включно
    assert.equal(cellStatus(4.5, 2), 'normal');
  });

  it('> 8 годин -> overtime (червоний)', () => {
    assert.equal(cellStatus(8.01, 1), 'overtime');
    assert.equal(cellStatus(12, 1), 'overtime');
  });
});
