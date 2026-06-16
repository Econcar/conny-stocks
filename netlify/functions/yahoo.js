// Proxy mot Yahoo Finance – körs på Netlify istället för en långsam gratis-proxy.
exports.handler = async function(event) {
  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Saknar url-parameter' }) };
  }

  // Tillåt bara anrop till Yahoo Finance (skyddar mot missbruk)
  if (!/^https:\/\/query[12]\.finance\.yahoo\.com\//.test(url)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Otillaten url' }) };
  }

  try {
    const response = await fetch(url, {
      headers: {
        // Yahoo kräver en User-Agent, annars blockerar de anropet
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });
    const data = await response.text();
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        // Mellanlagra svaret i 60 sekunder för snabbare upprepade anrop
        'Cache-Control': 'public, max-age=60'
      },
      body: data
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
