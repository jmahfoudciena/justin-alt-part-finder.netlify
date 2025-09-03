const { marked } = require('marked');
const fetch = require('node-fetch');

marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const googleKey = process.env.GOOGLE_API_KEY;
    const googleCx = process.env.GOOGLE_CX;

    const { partNumber } = JSON.parse(event.body || '{}');
    if (!partNumber) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Part number is required' }) };

    // --- Step 1: Google Custom Search for Digi-Key ---
    const query = `${partNumber} site:digikey.com`;
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&q=${encodeURIComponent(query)}`;
    const googleResp = await fetch(googleUrl);

    if (!googleResp.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Google Search request failed' }) };

    const googleData = await googleResp.json();
    const searchResults = (googleData.items || [])
      .filter(item => item.link.includes('digikey.com'))
      .slice(0, 3)
      .map(item => item.link);

    if (searchResults.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No Digi-Key links found' }) };

    // --- Step 2: Build GPT prompt ---
    const prompt = `
I have an electronic component with part number ${partNumber}. 

Here are Digi-Key links I found:
${searchResults.join('\n')}

Please identify:
1. The Package / Case of the original part.
2. Three alternative components that:
   - Are functionally equivalent
   - Have the same package type
   - Include manufacturer, key specs, and price if possible
   - Rank them by closeness to the original part
Provide the answer in Markdown.
`;

    // --- Step 3: Call OpenAI ---
    const gptResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful electronics engineer who finds component alternatives.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 3000
      })
    });

    if (!gptResp.ok) {
      const errorData = await gptResp.json();
      throw new Error(`OpenAI API Error: ${errorData.error?.message || gptResp.statusText}`);
    }

    const data = await gptResp.json();
    const markdownContent = data.choices?.[0]?.message?.content || '';
    const htmlContent = marked(markdownContent);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        partNumber,
        searchResults,
        alternativesMarkdown: markdownContent,
        alternativesHTML: htmlContent
      })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Server error' }) };
  }
};
