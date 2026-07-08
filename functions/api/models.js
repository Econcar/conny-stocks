// Vilka Anthropic-modeller frontend får välja mellan (Cloudflare Pages Function).
export async function onRequest() {
  return new Response(JSON.stringify({
    allowed: [
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5'
    ],
    default: 'claude-sonnet-4-6'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
