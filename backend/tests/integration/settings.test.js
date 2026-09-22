import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestApp, resetDb } from '../helpers/testApp.js';

describe('settings — GET/PATCH /settings (мінімальна ЗП)', () => {
  let ctx;

  before(async () => {
    ctx = await createTestApp();
  });

  after(async () => {
    await ctx.close();
  });

  beforeEach(() => resetDb(ctx.db));

  it('за замовчуванням minimum_wage = 0', async () => {
    const res = await ctx.api.get('/api/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.minimum_wage, 0);
  });

  it('PATCH оновлює значення', async () => {
    const res = await ctx.api.patch('/api/settings', { minimum_wage: 8000, updated_by: 'Марія' });
    assert.equal(res.status, 200);
    assert.equal(res.body.minimum_wage, 8000);
    assert.equal(res.body.updated_by, 'Марія');

    const reloaded = await ctx.api.get('/api/settings');
    assert.equal(reloaded.body.minimum_wage, 8000);
  });

  it('відʼємне значення -> 422', async () => {
    const res = await ctx.api.patch('/api/settings', { minimum_wage: -1 });
    assert.equal(res.status, 422);
  });
});
