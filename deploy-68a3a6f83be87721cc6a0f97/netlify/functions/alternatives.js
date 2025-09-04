const fetch = require('node-fetch');
const { marked } = require('marked');
require('dotenv').config();

marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

// Helper: Google Custom Search to get original part info and candidate parts
async function googleSearch(partNumber, numResults = 6) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CX;
  if (!googleKey || !googleCx) throw new Error('Missing GOOGLE_API_KEY or GOOGLE_CX');

  const query = `${partNumber} datasheet OR site:digikey.com OR site:mouser.com OR site:arrow.com OR site:avnet.com OR site:ti.com filetype:pdf`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&num=${numResults}&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Google Search API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return Array.isArray(data.items)
    ? data.items.map(it => ({ title: it.title, link: it.link, snippet: it.snippet || '' }))
    : [];
}

// Helper: Build a prompt for OpenAI
function buildOpenAIPrompt(partNumber, searchItems) {
  const searchSummary = searchItems.length
    ? searchItems
        .slice(0, 6)
        .map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.link}\n${r.snippet}`)
        .join('\n\n')
    : 'No search results found.';

  return `
I need to find 3 verified alternative components for the electronic part number: ${partNumber}.

Use the following web search results (datasheets, distributors) as context:
${searchSummary}

Verification requirements:
1. Confirm package type, pinout, electrical specs, functionality from datasheets.
2. Ensure alternatives are from reputable manufacturers.
3. Provide price and lifecycle info (Active/NRND/Last Time Buy).
4. Rank alternatives by package match, functional match, lifecycle status, and distributor availability.
5. Include clear citations from datasheets or distributor listings.
6. Format alternatives with numbered sections, headings, and bullet points.
`;
}

// Netlify Function handler
exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: 'Missing OPENAI_API_KEY' };

    const body = JSON.parse(event.body || '{}');
    const { partNumber } = body;
    if (!partNumber) return { statusCode: 400, body: 'partNumber is required' };

    // 1) Google search for datasheets/distributors
    let searchItems = [];
    try {
      searchItems = await googleSearch(partNumber);
    } catch (e) {
      console.warn('Google search failed, continuing without results:', e.message);
    }

    // 2) OpenAI verification and ranking
    const userPrompt = buildOpenAIPrompt(partNumber, searchItems);

    const openAIResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a professional electronics engineer specializing in verified alternative components. Provide accurate, cited alternatives with detailed specs.'
          },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 16384,
        temperature: 0.2
      })
    });

    if (!openAIResp.ok) {
      const err = await openAIResp.json().catch(() => ({}));
      throw new Error(err.error?.message || 'OpenAI API error');
    }

    const data = await openAIResp.json();
    const markdownContent = data.choices?.[0]?.message?.content || '';
    const htmlContent = marked(markdownContent).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alternatives: htmlContent,
        raw: markdownContent,
        searchResults: searchItems
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Server error' })
    };
  }
};
