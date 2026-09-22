import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTestApp } from '../helpers/testApp.js';

let db;
let withTransaction;

describe('db/index.js — withTransaction', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
    ({ db, withTransaction } = await import('../../src/db/index.js'));
  });

  after(async () => {
    await ctx.close();
  });

  it('фіксує зміни, коли функція завершується без помилки', () => {
    withTransaction(() => {
      db.prepare('INSERT INTO employees (full_name) VALUES (?)').run('Транзакційний');
    });

    const row = db.prepare('SELECT * FROM employees WHERE full_name = ?').get('Транзакційний');
    assert.ok(row);
  });

  it('відкочує зміни, якщо функція кидає помилку', () => {
    assert.throws(() =>
      withTransaction(() => {
        db.prepare('INSERT INTO employees (full_name) VALUES (?)').run('Відкат');
        throw new Error('навмисна помилка');
      }),
    );

    const row = db.prepare('SELECT * FROM employees WHERE full_name = ?').get('Відкат');
    assert.equal(row, undefined);
  });
});
