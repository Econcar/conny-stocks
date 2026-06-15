exports.handler = async function() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      default: 'claude-sonnet-4-6'
    })
  };
};
