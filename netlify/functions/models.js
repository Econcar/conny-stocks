exports.handler = async function() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed: [
        'claude-fable-5',
        'claude-opus-4-8',
        'claude-sonnet-4-6',
        'claude-haiku-4-5'
      ],
      default: 'claude-sonnet-4-6'
    })
  };
};
