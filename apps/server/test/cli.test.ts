import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { runCli } from '../src/cli.js';
import { listInvites, login, register } from '../src/accounts/service.js';

function io(answers: string[]) {
  const out: string[] = [];
  return {
    out,
    io: {
      print: (s: string) => void out.push(s),
      prompt: async (_q: string, _hidden?: boolean) => answers.shift() ?? '',
    },
  };
}

describe('admin CLI', () => {
  it('create-admin asks for the password twice and creates an admin', async () => {
    const db = await createDb({ memory: true });
    const t = io(['adminpass1', 'adminpass1']);
    expect(await runCli(['create-admin', 'root', '站长'], db, t.io)).toBe(0);
    const a = await login(db, { username: 'root', password: 'adminpass1' });
    expect(a).toMatchObject({ isAdmin: true, displayName: '站长' });
  });

  it('create-admin refuses mismatched passwords', async () => {
    const db = await createDb({ memory: true });
    const t = io(['adminpass1', 'different1']);
    expect(await runCli(['create-admin', 'root'], db, t.io)).toBe(1);
    expect(t.out.join('\n')).toMatch(/不一致/);
  });

  it('invite-permanent makes a reusable never-expiring code; invite-revoke disables it', async () => {
    const db = await createDb({ memory: true });
    const t = io([]);
    expect(await runCli(['invite-permanent', '666666'], db, t.io)).toBe(0);
    for (const [username, displayName] of [['aa', 'A'], ['bb', 'B'], ['cc', 'C']]) {
      await register(db, { username, displayName, password: '123456', inviteCode: '666666' });
    }
    const row = (await listInvites(db)).find((i) => i.code === '666666')!;
    expect(row).toMatchObject({ reusable: true, uses: 3, expiresAt: null });
    expect(await runCli(['invite-permanent', '666666'], db, io([]).io)).toBe(0); // idempotent
    expect(await runCli(['invite-revoke', '666666'], db, io([]).io)).toBe(0);
    await expect(register(db, { username: 'dd', displayName: 'D', password: '123456', inviteCode: '666666' })).rejects.toThrow(/邀请码/);
    expect(await runCli(['invite-revoke', 'NOPE'], db, io([]).io)).toBe(1);
  });

  it('invite prints the requested number of codes; unknown commands print usage', async () => {
    const db = await createDb({ memory: true });
    const t = io([]);
    expect(await runCli(['invite', '3'], db, t.io)).toBe(0);
    expect(t.out.filter((l) => /^[A-Z2-9]{8}$/.test(l))).toHaveLength(3);
    const u = io([]);
    expect(await runCli(['bogus'], db, u.io)).toBe(1);
    expect(u.out.join('\n')).toMatch(/create-admin/);
  });

  it('reset-password prints a temporary password for a username', async () => {
    const db = await createDb({ memory: true });
    await runCli(['create-admin', 'root'], db, io(['adminpass1', 'adminpass1']).io);
    const t = io([]);
    expect(await runCli(['reset-password', 'root'], db, t.io)).toBe(0);
    const temp = t.out.at(-1)!.split('：').at(-1)!.trim();
    expect((await login(db, { username: 'root', password: temp })).username).toBe('root');
  });
});
