import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IMPERSONATION_MS, TestCommand } from '../src/commands.js';
import { loadConfig } from '../src/config.js';
import type { KookEvent } from '../src/types.js';

const ADMIN = '414517557';
const PG = '1407892120';
const ZY = '2262413188';

function setup() {
  let now = 1_000_000;
  const replies: { channelId: string; content: string; tempTargetId?: string }[] = [];
  const command = new TestCommand({
    admins: [ADMIN],
    aliases: { pg: PG, zy: ZY },
    api: {
      async sendMessage(channelId, content, options) {
        replies.push({ channelId, content, tempTargetId: options?.tempTargetId });
      },
    },
    now: () => now,
  });
  return { command, replies, advance: (ms: number) => (now += ms) };
}

function message(content: string, overrides: Partial<KookEvent> = {}): KookEvent {
  return {
    type: 9,
    channel_type: 'GROUP',
    target_id: 'text-channel',
    author_id: ADMIN,
    content,
    extra: { type: 9, author: { id: ADMIN } },
    msg_id: 'msg',
    msg_timestamp: 0,
    ...overrides,
  };
}

test('.test <alias> makes the admin count as that user for 3 minutes', async () => {
  const { command, replies, advance } = setup();
  assert.equal(command.effectiveUserId(ADMIN), ADMIN);

  assert.equal(await command.handle(message('.test pg')), true);
  assert.equal(command.effectiveUserId(ADMIN), PG);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].channelId, 'text-channel');
  assert.equal(replies[0].tempTargetId, ADMIN);
  assert.match(replies[0].content, /3 分钟.*pg/);

  advance(IMPERSONATION_MS - 1);
  assert.equal(command.effectiveUserId(ADMIN), PG);
  advance(1);
  assert.equal(command.effectiveUserId(ADMIN), ADMIN);
});

test('sending .test again switches target and restarts the timer', async () => {
  const { command, advance } = setup();
  await command.handle(message('.test pg'));
  advance(IMPERSONATION_MS - 1000);
  await command.handle(message('.TEST zy'));
  assert.equal(command.effectiveUserId(ADMIN), ZY);
  advance(IMPERSONATION_MS - 1);
  assert.equal(command.effectiveUserId(ADMIN), ZY);
});

test('only the admin is impersonating; other users are unaffected', async () => {
  const { command } = setup();
  await command.handle(message('.test pg'));
  assert.equal(command.effectiveUserId('someone-else'), 'someone-else');
  assert.equal(command.effectiveUserId(PG), PG);
});

test('messages from non-admins, bots, DMs and non-commands are ignored', async () => {
  const { command, replies } = setup();
  const ignored = [
    message('.test pg', { author_id: 'someone-else' }),
    message('.test pg', { extra: { type: 9, author: { id: ADMIN, bot: true } } }),
    message('.test pg', { channel_type: 'PERSON' }),
    message('.test pg', { type: 10 }),
    message('hello'),
    message('.testing pg'),
  ];
  for (const d of ignored) assert.equal(await command.handle(d), false);
  assert.equal(command.effectiveUserId(ADMIN), ADMIN);
  assert.equal(replies.length, 0);
});

test('unknown alias or wrong arguments reply with usage and do not impersonate', async () => {
  const { command, replies } = setup();
  for (const content of ['.test', '.test nobody', '.test pg zy', `.test ${PG}`]) {
    assert.equal(await command.handle(message(content)), true);
  }
  assert.equal(command.effectiveUserId(ADMIN), ADMIN);
  assert.equal(replies.length, 4);
  for (const reply of replies) assert.match(reply.content, /用法：\.test <简称>，可用简称：pg、zy/);
});

test('KMarkdown escapes in the message are ignored', async () => {
  const { command } = setup();
  await command.handle(message('\\.test p\\g'));
  assert.equal(command.effectiveUserId(ADMIN), PG);
});

test('a failed reply does not break the command', async () => {
  const command = new TestCommand({
    admins: [ADMIN],
    aliases: { pg: PG },
    api: {
      async sendMessage() {
        throw new Error('no permission');
      },
    },
  });
  assert.equal(await command.handle(message('.test pg')), true);
  assert.equal(command.effectiveUserId(ADMIN), PG);
});

function withConfig(extra: Record<string, unknown>, check: () => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'kook-commands-'));
  const previousPath = process.env.CONFIG_PATH;
  const previousToken = process.env.KOOK_BOT_TOKEN;
  try {
    const configPath = join(directory, 'config.json');
    writeFileSync(configPath, JSON.stringify({ rules: [{ userId: PG, sound: 'a.mp3' }], ...extra }));
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

test('admins and aliases are optional and load when valid', () => {
  withConfig({}, () => assert.doesNotThrow(() => loadConfig()));
  withConfig({ admins: [ADMIN], aliases: { pg: PG, zy_2: ZY } }, () => {
    const { config } = loadConfig();
    assert.deepEqual(config.admins, [ADMIN]);
    assert.deepEqual(config.aliases, { pg: PG, zy_2: ZY });
  });
});

test('invalid admins or aliases fail at startup', () => {
  for (const admins of ['414517557', [414517557], [''], [null]]) {
    withConfig({ admins }, () => assert.throws(() => loadConfig(), /admins/));
  }
  for (const aliases of [
    [],
    'pg',
    null,
    { 胖哥: PG },
    { '1pg': PG },
    { 'p g': PG },
    { pg: '' },
    { pg: 1407892120 },
    { pg: PG, PG: ZY },
  ]) {
    withConfig({ aliases }, () => assert.throws(() => loadConfig(), /aliases/));
  }
});
