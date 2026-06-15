const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const helmet = require('helmet');

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(bodyParser.json());

// Models configuration: comma-separated list in env var
const allowedModelsEnv = process.env.CLAUDE_ALLOWED_MODELS || 'claude-sonnet-4-6,claude-2';
const allowedModels = allowedModelsEnv.split(',').map(s => s.trim()).filter(Boolean);
const defaultModel = process.env.CLAUDE_DEFAULT_MODEL || allowedModels[0];

app.get('/api/models', (req, res) => {
  res.json({ allowed: allowedModels, default: defaultModel });
});

app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server saknar CLAUDE_API_KEY' });
  }

  // Validate model selection
  const requestedModel = req.body?.model;
  const modelToUse = requestedModel && allowedModels.includes(requestedModel) ? requestedModel : defaultModel;

  // Ensure the body has the model set to the allowed/default
  const proxiedBody = { ...req.body, model: modelToUse };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(proxiedBody)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

module.exports = app;
