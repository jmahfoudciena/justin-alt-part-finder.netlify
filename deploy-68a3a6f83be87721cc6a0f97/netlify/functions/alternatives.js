const fetch = require('node-fetch');
const cheerio = require('cheerio');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { partNumber } = JSON.parse(event.body || '{}');
    if (!partNumber) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Part number is required' }) };

    const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
    const GOOGLE_CX = process.env.GOOGLE_CX;
    if (!GOOGLE_KEY || !GOOGLE_CX) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Google API credentials missing' }) };

    // --- Step 1: Google Custom Search ---
    const query = `${partNumber} site:digikey.com`;
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}`;

    let googleData;
    try {
      const resp = await fetch(googleUrl);
      googleData = await resp.json();
    } catch (err) {
      console.error('Google Search failed:', err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Google Search failed' }) };
    }

    const searchResults = (googleData.items || [])
      .filter(item => /digikey\.com/.test(item.link))
      .slice(0, 3)
      .map(item => item.link);

    // --- Step 2: Scrape Digi-Key Pages ---
    const packageInfoList = [];
    for (const url of searchResults) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;

        const html = await resp.text();
        const $ = cheerio.load(html);

        const packageType = $('table[data-testid="product-details-specs"] tr')
          .filter((i, el) => $(el).find('th').text().trim() === 'Package / Case')
          .find('td')
          .text()
          .trim();

        if (packageType) {
          packageInfoList.push({ url, packageType });
        }
      } catch (err) {
        console.error(`Failed to scrape ${url}:`, err);
      }
    }

    // --- Step 3: Return results ---
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        partNumber,
        packageInfoList,
        googleSearchResults: searchResults,
        googleRawData: googleData
      })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Server error' }) };
  }
};
