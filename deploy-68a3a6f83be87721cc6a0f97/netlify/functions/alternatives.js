const { marked } = require('marked');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

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

    // --- Step 2: Scrape first Digi-Key product page ---
    let packageType = null;
    let productUrl = null;

    for (const url of searchResults) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;

        const html = await resp.text();
        const $ = cheerio.load(html);

        const pkg = $('table[data-testid="product-details-specs"] tr')
          .filter((i, el) => $(el).find('th').first().text().trim() === 'Package / Case')
          .find('td')
          .first()
          .text()
          .trim();

        if (pkg) {
          packageType = pkg;
          productUrl = url;
          break; // Stop after first valid package
        }
      } catch (err) {
        console.warn('Failed to fetch/parse Digi-Key page:', url, err.message);
      }
    }

    if (!packageType) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Package / Case not found' }) };

    // --- Step 3: Build GPT prompt ---
    const prompt = `I have an electronic component with part number ${partNumber} and package type ${packageType} (from Digi-Key). 
Please identify 3 alternative components that:
- Are functionally equivalent
- Have the same package type (${packageType})
- Include manufacturer, key specs, and price if possible
- Rank them by closeness to the original part
Provide the answer in Markdown.`;

    // --- Step 4: Call OpenAI ---
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
        packageType,
        productUrl,
        alternativesMarkdown: markdownContent,
        alternativesHTML: htmlContent
      })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Server error' }) };
  }
};
