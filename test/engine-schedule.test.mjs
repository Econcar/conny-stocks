// Enhetstester för motorns schema (shared/engine-schedule.js – delas av appen och motorn).
// Körs med:  node --test test/
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { engineSettingsMerge, engineDayDiff, engineJobDue, engineNextRun } = require('../shared/engine-schedule.js');

const at = (d, h = 6, m = 0) => new Date(`2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

test('standardvärden utan tabell eller rader', () => {
  const s = engineSettingsMerge(null);
  assert.equal(s.all.enabled, true);
  assert.equal(s.news.every_days, 1);
  assert.equal(s.megatrends.every_days, 7);
  assert.equal(s.discovery.every_days, 7);
  assert.equal(s.deep.every_days, null);
  assert.equal(s.aifunds.every_days, null);
});

test('sparade rader vinner, ogiltiga intervall ger standard', () => {
  const s = engineSettingsMerge([{ id: 'risk', enabled: false, every_days: 3 }, { id: 'cio', every_days: 0 }, { id: 'deep', every_days: 5 }]);
  assert.equal(s.risk.enabled, false);
  assert.equal(s.risk.every_days, 3);
  assert.equal(s.cio.every_days, 1);
  assert.equal(s.deep.every_days, null); // djupanalysen har inget eget intervall
});

test('dygn räknas på UTC-datum – en sen körning skjuter inte nästa dag', () => {
  assert.equal(engineDayDiff(at(1, 6, 25).toISOString(), at(2, 6, 0)), 1);
  assert.equal(engineDayDiff(at(1, 23, 59).toISOString(), at(2, 0, 1)), 1);
  assert.equal(engineDayDiff(at(1, 6).toISOString(), at(1, 22)), 0);
});

test('dags att köra: intervall, saknad körtid och reserv från ai_usage', () => {
  const s = engineSettingsMerge([{ id: 'megatrends', every_days: 7, last_run_at: at(1, 6, 10).toISOString() }]);
  assert.equal(engineJobDue(s, 'megatrends', at(7)).due, false);
  assert.equal(engineJobDue(s, 'megatrends', at(7)).daysLeft, 1);
  assert.equal(engineJobDue(s, 'megatrends', at(8)).due, true);
  assert.equal(engineJobDue(s, 'discovery', at(8)).due, true);                          // aldrig körd
  assert.equal(engineJobDue(s, 'discovery', at(8), at(5).toISOString()).due, false);     // reserv: körd för 3 d sedan
  assert.equal(engineJobDue(s, 'news', at(2)).due, true);
});

test('paus: enskilt jobb, hela motorn och djupanalys när nyhetstriagen är av', () => {
  let s = engineSettingsMerge([{ id: 'cio', enabled: false }]);
  assert.equal(engineJobDue(s, 'cio', at(2)).paused, true);
  assert.equal(engineJobDue(s, 'risk', at(2)).due, true);
  s = engineSettingsMerge([{ id: 'all', enabled: false }]);
  assert.equal(engineJobDue(s, 'risk', at(2)).due, false);
  assert.equal(engineNextRun(s, 'risk', at(2)), null);
  s = engineSettingsMerge([{ id: 'news', enabled: false }]);
  assert.equal(engineJobDue(s, 'deep', at(2)).paused, true);
});

test('nästa körning: nästa dygnsstart då jobbet är dags', () => {
  const s = engineSettingsMerge([{ id: 'megatrends', last_run_at: at(1, 6, 10).toISOString() }, { id: 'risk', last_run_at: at(1, 6, 5).toISOString() }]);
  assert.equal(engineNextRun(s, 'megatrends', at(1, 12)).toISOString(), at(8).toISOString());
  assert.equal(engineNextRun(s, 'risk', at(1, 12)).toISOString(), at(2).toISOString());
  assert.equal(engineNextRun(s, 'risk', at(2, 5)).toISOString(), at(2).toISOString()); // före dagens start
});
