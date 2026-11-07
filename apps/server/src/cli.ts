/**
 * Admin command line. Usage (dev):  pnpm --filter @poker/server admin <command>
 *                    (production):  docker compose exec app node dist/cli.js <command>
 */
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import { adminResetPassword, createAdmin, createInvites, promote } from './accounts/service.js';
import { normalizeUsername } from './accounts/names.js';
import { createDb, type Db } from './db/client.js';
import { players } from './db/schema.js';
import { HttpError } from './http.js';

export interface CliIo {
  print(line: string): void;
  prompt(question: string, hidden?: boolean): Promise<string>;
}

const USAGE = [
  '用法：',
  '  create-admin <用户名> [显示名]   创建管理员（会提示输入两次密码）',
  '  promote <用户名>                 把已有账号设为管理员',
  '  invite [数量] [有效天数]         生成邀请码（默认 1 个，不过期）',
  '  reset-password <用户名>          重置密码，打印临时密码',
];

/** Returns the process exit code. */
export async function runCli(argv: string[], db: Db, io: CliIo): Promise<number> {
  const [cmd, ...args] = argv;
  try {
    switch (cmd) {
      case 'create-admin': {
        if (!args[0]) break;
        const pw = await io.prompt('密码（至少 6 位）：', true);
        const again = await io.prompt('再输入一次：', true);
        if (pw !== again) {
          io.print('两次输入的密码不一致');
          return 1;
        }
        const a = await createAdmin(db, args[0], args[1] ?? args[0], pw);
        io.print(`已创建管理员 ${a.username}（显示名：${a.displayName}）`);
        return 0;
      }
      case 'promote':
        if (!args[0]) break;
        await promote(db, args[0]);
        io.print(`${normalizeUsername(args[0])} 已设为管理员`);
        return 0;
      case 'invite': {
        const n = Number(args[0] ?? 1) || 1;
        const days = args[1] === undefined ? undefined : Number(args[1]) || undefined;
        const codes = await createInvites(db, null, n, days);
        io.print(`已生成 ${codes.length} 个邀请码${days ? `（${days} 天内有效）` : ''}：`);
        for (const c of codes) io.print(c);
        return 0;
      }
      case 'reset-password': {
        if (!args[0]) break;
        const [row] = await db.select({ id: players.id }).from(players).where(eq(players.username, normalizeUsername(args[0])));
        if (!row) throw new HttpError(404, '没有这个用户');
        const temp = await adminResetPassword(db, row.id);
        io.print(`临时密码：${temp}`);
        return 0;
      }
    }
  } catch (e) {
    io.print(e instanceof HttpError ? e.message : `出错了：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  USAGE.forEach((l) => io.print(l));
  return 1;
}

/** Terminal IO; hidden prompts do not echo what is typed. */
function terminalIo(): CliIo {
  return {
    print: (l) => console.log(l),
    prompt: (q, hidden) =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
          (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
            if (s.includes(q)) process.stdout.write(q);
          };
        }
        rl.question(q, (answer) => {
          rl.close();
          if (hidden) process.stdout.write('\n');
          resolve(answer);
        });
      }),
  };
}

// Run when executed directly (not when imported by tests).
const isMain = process.argv[1] && /cli\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  const db = await createDb();
  const code = await runCli(process.argv.slice(2), db, terminalIo());
  await (db as unknown as { $client: { close?: () => Promise<void>; end?: () => Promise<void> } }).$client.close?.();
  await (db as unknown as { $client: { end?: () => Promise<void> } }).$client.end?.();
  process.exit(code);
}
