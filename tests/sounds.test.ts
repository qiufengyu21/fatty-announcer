import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { selectSound } from '../src/sounds.js';
import type { Rule } from '../src/types.js';

const weightedRule: Rule = {
  userId: 'pange',
  sounds: [
    { sound: 'A.mp3', weight: 20 },
    { sound: 'B.mp3', weight: 30 },
    { sound: 'C.mp3', weight: 50 },
  ],
};

function withConfig(rule: unknown, check: () => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'kook-sounds-'));
  const previousPath = process.env.CONFIG_PATH;
  const previousToken = process.env.KOOK_BOT_TOKEN;
  try {
    const configPath = join(directory, 'config.json');
    writeFileSync(configPath, JSON.stringify({ rules: [rule] }));
    process.env.CONFIG_PATH = configPath;
    process.env.KOOK_BOT_TOKEN = 'test-token';
    check();
  } finally {
    if (previousPath === undefined) delete process.env.CONFIG_PATH;
    else process.env.CONFIG_PATH = previousPath;
    if (previousToken === undefined) delete process.env.KOOK_BOT_TOKEN;
    else process.env.KOOK_BOT_TOKEN = previousToken;
    rmSync(directory, { recursive: true, force: true });
  }
}

test('selects the correct sound at 20/30/50 boundaries', () => {
  for (const [draw, expected] of [
    [0, 'A.mp3'],
    [0.199999, 'A.mp3'],
    [0.2, 'B.mp3'],
    [0.499999, 'B.mp3'],
    [0.5, 'C.mp3'],
    [0.999999, 'C.mp3'],
  ] as const) {
    assert.equal(selectSound(weightedRule, () => draw), expected);
  }
});

test('weights divide the random interval into the expected proportions', () => {
  const counts: Record<string, number> = {};
  for (let sample = 0; sample < 10000; sample++) {
    const sound = selectSound(weightedRule, () => (sample + 0.5) / 10000);
    counts[sound] = (counts[sound] ?? 0) + 1;
  }
  assert.deepEqual(counts, { 'A.mp3': 2000, 'B.mp3': 3000, 'C.mp3': 5000 });
});

test('weights need not add up to 100', () => {
  const rule = {
    ...weightedRule,
    sounds: weightedRule.sounds!.map((entry) => ({ ...entry, weight: entry.weight / 10 })),
  };
  assert.equal(selectSound(rule, () => 0.1), 'A.mp3');
  assert.equal(selectSound(rule, () => 0.3), 'B.mp3');
  assert.equal(selectSound(rule, () => 0.8), 'C.mp3');
});

test('single weighted sound is always selected', () => {
  const rule = { userId: 'pange', sounds: [{ sound: 'only.mp3', weight: 1 }] };
  assert.equal(selectSound(rule, () => 0), 'only.mp3');
  assert.equal(selectSound(rule, () => 0.999999), 'only.mp3');
});

test('100/0 rules always select the enabled sound for both events in any position', () => {
  for (const event of ['joined', 'exited'] as const) {
    for (const enabledIndex of [0, 1, 2]) {
      const sounds = ['A.mp3', 'B.mp3', 'C.mp3'].map((sound, index) => ({
        sound,
        weight: index === enabledIndex ? 100 : 0,
      }));
      withConfig({ userId: 'pange', event, sounds }, () => {
        const { config } = loadConfig();
        for (const draw of [0, 0.2, 0.5, 1 - Number.EPSILON]) {
          assert.equal(selectSound(config.rules[0], () => draw), sounds[enabledIndex].sound);
        }
      });
    }
  }
});

test('disabled sounds never play and preserve the remaining weight proportions', () => {
  const rule = {
    userId: 'pange',
    sounds: [
      { sound: 'disabled-first.mp3', weight: 0 },
      { sound: 'A.mp3', weight: 20 },
      { sound: 'disabled-middle.mp3', weight: 0 },
      { sound: 'B.mp3', weight: 30 },
      { sound: 'C.mp3', weight: 50 },
      { sound: 'disabled-last.mp3', weight: 0 },
    ],
  };
  const counts: Record<string, number> = {};
  for (let sample = 0; sample < 10000; sample++) {
    const sound = selectSound(rule, () => sample / 10000);
    counts[sound] = (counts[sound] ?? 0) + 1;
  }
  assert.deepEqual(counts, { 'A.mp3': 2000, 'B.mp3': 3000, 'C.mp3': 5000 });
});

test('rounding fallback cannot select a disabled trailing sound', () => {
  const rule = {
    userId: 'pange',
    sounds: [
      { sound: 'enabled.mp3', weight: Number.MIN_VALUE },
      { sound: 'disabled.mp3', weight: 0 },
    ],
  };
  assert.equal(selectSound(rule, () => 1 - Number.EPSILON), 'enabled.mp3');
});

test('all-zero sound lists fail at startup with a clear error', () => {
  for (const sounds of [
    [{ sound: 'A.mp3', weight: 0 }],
    [{ sound: 'A.mp3', weight: 0 }, { sound: 'B.mp3', weight: 0 }],
  ]) {
    withConfig({ userId: 'pange', sounds }, () => assert.throws(() => loadConfig(), /weight.*0/));
  }
});

test('legacy sound rules still load and select without randomness', () => {
  withConfig({ userId: 'pange', sound: 'legacy.mp3' }, () => {
    const { config } = loadConfig();
    assert.equal(selectSound(config.rules[0], () => assert.fail('unexpected random draw')), 'legacy.mp3');
  });
});

test('weighted rules load for both joined and exited events', () => {
  for (const event of ['joined', 'exited'] as const) {
    withConfig({ ...weightedRule, event }, () => {
      const { config } = loadConfig();
      assert.equal(config.rules[0].event, event);
      assert.equal(selectSound(config.rules[0], () => 0.8), 'C.mp3');
    });
  }
});

test('invalid or ambiguous sound configurations fail at startup', () => {
  for (const invalid of [
    {},
    { sound: '' },
    { sound: '   ' },
    { sounds: [] },
    { sounds: null },
    { sounds: 'A.mp3' },
    { sound: 'legacy.mp3', sounds: weightedRule.sounds },
    { sounds: [null] },
    { sounds: [{ weight: 1 }] },
    { sounds: [{ sound: '   ', weight: 1 }] },
    ...[undefined, null, '20', -1].map((weight) => ({ sounds: [{ sound: 'A.mp3', weight }] })),
    { sounds: [{ sound: 'A.mp3', weight: Number.MAX_VALUE }, { sound: 'B.mp3', weight: Number.MAX_VALUE }] },
  ]) {
    withConfig({ userId: 'pange', ...invalid }, () => assert.throws(() => loadConfig(), /sound/));
  }
});