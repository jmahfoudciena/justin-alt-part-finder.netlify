// netlify/functions/alternatives.js
const fetch = require('node-fetch');
const { marked } = require('marked');
const cheerio = require('cheerio'); // For scraping Digi-Key
require('dotenv').config();

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { partNumber } = JSON.parse(event.body || '{}');
    if (!partNumber) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Part number is required' }) };

    // --- Step 1: Google Custom Search ---
    const googleKey = process.env.GOOGLE_API_KEY;
    const googleCx = process.env.GOOGLE_CX;
    let searchResults = [];
    let googleRawData = null;

    if (googleKey && googleCx) {
      const query = `${partNumber} site:digikey.com`;
      const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&q=${encodeURIComponent(query)}`;
      const resp = await fetch(url);
      if (resp.ok) {
        googleRawData = await resp.json();
        searchResults = (googleRawData.items || [])
          .filter(item => /digikey\.com/.test(item.link))
          .slice(0, 5)
          .map(item => item.link);
      }
    }

    // --- Step 2: Scrape Digi-Key Pages for "Package / Case" ---
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
        // ignore scraping errors
      }
    }

    // --- Step 3: Build GPT prompt ---
    const prompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.

Here is the package info extracted from Digi-Key:
${packageInfoList.length > 0 ? JSON.stringify(packageInfoList, null, 2) : "[No package info found]"}
    
Please provide functionally equivalent alternatives, verifying package compatibility.`;

    // --- Step 4: Call OpenAI ---
    const apiKey = process.env.OPENAI_API_KEY;
    let htmlContent = '';
    let markdownContent = '';

    if (apiKey) {
      const openAIResp = await fetch('https://api.openai.com/v1/chat/completions', {
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
          max_tokens: 4000
        })
      });

      if (openAIResp.ok) {
        const data = await openAIResp.json();
        markdownContent = data.choices?.[0]?.message?.content || '';
        htmlContent = marked(markdownContent);
      }
    }

    // --- Step 5: Return combined result ---
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        alternatives: htmlContent,
        raw: markdownContent,
        packageInfoList,
        googleSearchResults: searchResults,
        googleRawData
      })
    };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Server error' }) };
  }
};
