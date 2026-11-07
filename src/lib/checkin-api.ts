// Calls the Claude API for the weekly check-in. Loaded only when a check-in runs, so the
// Anthropic library doesn't slow down opening the app.
import Anthropic from '@anthropic-ai/sdk';
import { CHECKIN_MODEL, CheckInResult, SCHEMA, SYSTEM, type CheckInImage } from './checkin';

export class CheckInError extends Error {}

/** Ask Claude for the check-in. `fetchImpl` is only for tests. */
export async function requestCheckIn(opts: {
  apiKey: string;
  report: string;
  images: CheckInImage[];
  fetchImpl?: typeof fetch;
}): Promise<{ result: CheckInResult; model: string; usage: { input: number; output: number } }> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true, // the key is James's own, typed in on his phone; there's no server
    maxRetries: 1,
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
  });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of opts.images) {
    content.push({ type: 'text', text: img.label });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.data } });
  }
  content.push({ type: 'text', text: opts.report });

  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: CHECKIN_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    throw new CheckInError(friendlyError(e));
  }
  if (res.stop_reason === 'refusal') throw new CheckInError("Claude couldn't do this check-in. Try again, or change your note.");
  if (res.stop_reason === 'max_tokens') throw new CheckInError('The answer came back cut off. Try again.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed: CheckInResult;
  try {
    parsed = CheckInResult.parse(JSON.parse(text));
  } catch {
    throw new CheckInError("Claude's answer couldn't be read. Try again.");
  }
  return { result: parsed, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The API key didn't work. Check it in Settings → Claude check-in.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use Claude. Check it in the Console.";
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a minute and try again.';
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) {
      return "Your API credits are used up for this month. Check-ins work again when next month's credits arrive.";
    }
    return `Claude couldn't take this request: ${e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError) return 'No connection to Claude. Check your internet and try again.';
  if (e instanceof Anthropic.APIError) return `Claude had a problem (${e.status ?? 'error'}). Try again in a few minutes.`;
  return `Something went wrong: ${(e as Error)?.message ?? e}`;
}

