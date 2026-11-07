/**
 * OpenAI-compatible chat client (DeepSeek / Qwen / GLM all expose /chat/completions).
 * Configured by LLM_BASE_URL, LLM_API_KEY, LLM_MODEL. The key never leaves the server.
 */
export interface LlmClient {
  explain(system: string, user: string, signal: AbortSignal, opts?: { maxTokens?: number; maxChars?: number }): Promise<string>;
}

const MAX_CHARS = 2000;

/** Drop script/style blocks and all tags, collapse blank runs, cap at maxChars (default 2000) characters. */
export function sanitizeLlmText(s: string, maxChars: number = MAX_CHARS): string {
  const text = s
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [...text].slice(0, maxChars).join('');
}

export function createLlmClient(env: NodeJS.ProcessEnv | Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): LlmClient | null {
  const key = env.LLM_API_KEY;
  if (!key) return null;
  const base = (env.LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = env.LLM_MODEL ?? 'deepseek-chat';
  return {
    async explain(system, user, signal, opts) {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: opts?.maxTokens ?? 1200,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('LLM returned no content');
      return sanitizeLlmText(content, opts?.maxChars);
    },
  };
}
