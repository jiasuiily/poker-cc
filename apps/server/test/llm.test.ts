import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createLlmClient, sanitizeLlmText } from '../src/llm.js';

let server: Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** Fake OpenAI-compatible endpoint. */
function fake(handler: (body: unknown) => { status?: number; delayMs?: number; content?: string }): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const out = handler(JSON.parse(raw || '{}'));
        setTimeout(() => {
          res.statusCode = out.status ?? 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ choices: [{ message: { content: out.content ?? '' } }] }));
        }, out.delayMs ?? 0);
      });
    });
    server.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`));
  });
}

describe('llm client', () => {
  it('returns null without an API key', () => {
    expect(createLlmClient({})).toBeNull();
  });

  it('sends system + user messages and returns the content', async () => {
    let seen: { model?: string; messages?: { role: string; content: string }[] } = {};
    const url = await fake((b) => {
      seen = b as typeof seen;
      return { content: '整体打得不错。' };
    });
    const llm = createLlmClient({ LLM_API_KEY: 'k', LLM_BASE_URL: url, LLM_MODEL: 'm1' })!;
    expect(await llm.explain('SYS', 'USER', new AbortController().signal)).toBe('整体打得不错。');
    expect(seen.model).toBe('m1');
    expect(seen.messages!.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('strips HTML from the answer', async () => {
    const url = await fake(() => ({ content: '<b>好</b><script>alert(1)</script>' }));
    const llm = createLlmClient({ LLM_API_KEY: 'k', LLM_BASE_URL: url })!;
    expect(await llm.explain('s', 'u', new AbortController().signal)).toBe('好');
  });

  it('throws on HTTP errors', async () => {
    const url = await fake(() => ({ status: 500 }));
    const llm = createLlmClient({ LLM_API_KEY: 'k', LLM_BASE_URL: url })!;
    await expect(llm.explain('s', 'u', new AbortController().signal)).rejects.toThrow();
  });

  it('aborts when the signal fires', async () => {
    const url = await fake(() => ({ delayMs: 500, content: 'late' }));
    const llm = createLlmClient({ LLM_API_KEY: 'k', LLM_BASE_URL: url })!;
    await expect(llm.explain('s', 'u', AbortSignal.timeout(100))).rejects.toThrow();
  });

  it('sanitize caps the length at 2000 characters', () => {
    expect([...sanitizeLlmText('好'.repeat(3000))]).toHaveLength(2000);
  });
});
