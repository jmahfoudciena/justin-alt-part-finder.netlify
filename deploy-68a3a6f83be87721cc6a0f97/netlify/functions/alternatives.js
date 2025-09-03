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
    const { partNumber } = JSON.parse(event.body || '{}');
    if (!partNumber) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Part number is required' }) };

    // --- Step 1: Search Digi-Key ---
    const searchUrl = `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(partNumber)}`;
    const searchResp = await fetch(searchUrl);
    if (!searchResp.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Digi-Key search failed' }) };

    const searchHtml = await searchResp.text();
    const $search = cheerio.load(searchHtml);

    // Extract the first product URL from search results
    const firstProductLink = $search('a[data-testid="product-link"]').first().attr('href');
    if (!firstProductLink) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No Digi-Key product found' }) };

    const productUrl = `https://www.digikey.com${firstProductLink}`;

    // --- Step 2: Fetch product page ---
    const productResp = await fetch(productUrl);
    if (!productResp.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Failed to fetch product page' }) };

    const productHtml = await productResp.text();
    const $product = cheerio.load(productHtml);

    // --- Step 3: Extract Package / Case ---
    const packageType = $product('table[data-testid="product-details-specs"] tr')
      .filter((i, el) => $product(el).find('th').first().text().trim() === 'Package / Case')
      .find('td')
      .first()
      .text()
      .trim();

    if (!packageType) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Package / Case not found' }) };

    // --- Step 4: Ask GPT to find 3 alternates with same package ---
    const prompt = `I have an electronic component with part number ${partNumber} and package type ${packageType} (from Digi-Key). 
Please identify 3 alternative components that:
- Are functionally equivalent
- Have the same package type (${packageType})
- Include manufacturer, key specs, and price if possible
- Rank them by closeness to the original part
Provide the answer in Markdown.`;

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
