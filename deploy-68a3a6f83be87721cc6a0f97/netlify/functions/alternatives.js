const fetch = require('node-fetch');
const { marked } = require('marked');
require('dotenv').config();

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

// -------------------
// Helper: Google Custom Search
// -------------------
async function googleSearch(partNumber) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CX;
  if (!googleKey || !googleCx) {
    throw new Error('Missing GOOGLE_API_KEY or GOOGLE_CX');
  }

  const query = `${partNumber} datasheet OR site:digikey.com OR site:mouser.com OR site:arrow.com OR site:avnet.com OR site:ti.com filetype:pdf`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&num=6&q=${encodeURIComponent(query)}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Google Search API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(it => ({
    title: it.title,
    link: it.link,
    snippet: it.snippet || ''
  }));
}

// -------------------
// Helper: Call OpenAI API
// -------------------
async function fetchOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      max_tokens: 16384,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'OpenAI API error');
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// -------------------
// Extract part numbers from GPT suggestion text
// -------------------
function extractPartNumbers(text) {
  // Simple regex to catch part-like strings (alphanumeric, dash, dot)
  const regex = /\b[A-Z0-9\-\.]{3,}\b/g;
  const matches = text.match(regex) || [];
  return [...new Set(matches)]; // unique
}

// -------------------
// Netlify Function Handler
// -------------------
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const body = JSON.parse(event.body || '{}');
    const { partNumber } = body;
    if (!partNumber) return { statusCode: 400, body: 'partNumber is required' };

    // 1) Google search for original part
    let originalSearchResults = [];
    try {
      originalSearchResults = await googleSearch(partNumber);
    } catch (e) {
      console.warn('Original part Google search failed:', e.message);
    }

    const originalSearchSummary = originalSearchResults.length
      ? originalSearchResults.slice(0, 6).map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.link}\n${r.snippet}`).join('\n\n')
      : 'No search results found.';

    // 2) Ask GPT to suggest candidate parts
    const candidatePrompt = [
      { role: 'system', content: 'You are a professional electronics engineer who suggests functionally equivalent alternative parts.' },
      {
        role: 'user',
        content: `Original part: ${partNumber}
Using the following search results, suggest 5 candidate alternative part numbers (different manufacturers, functionally equivalent, package-compatible):
${originalSearchSummary}`
      }
    ];
    const candidateResponse = await fetchOpenAI(candidatePrompt);
    const candidateParts = extractPartNumbers(candidateResponse).filter(p => p.toUpperCase() !== partNumber.toUpperCase()).slice(0, 5);

    // 3) Google search for each candidate
    const candidateSearchResults = [];
    for (const part of candidateParts) {
      try {
        const results = await googleSearch(part);
        candidateSearchResults.push({ part, results });
      } catch (e) {
        console.warn(`Candidate Google search failed for ${part}:`, e.message);
      }
    }

    // 4) Ask GPT to verify and rank top 3
    const verificationPrompt = [
      { role: 'system', content: 'You are a professional electronics engineer specializing in verified alternative components. Provide accurate, cited alternatives with detailed specs.' },
      {
        role: 'user',
        content: `
Original part: ${partNumber}
Original part search results:
${originalSearchSummary}

Candidate parts with search results:
${candidateSearchResults.map(c => c.part + '\n' + c.results.map(r => r.title + ' ' + r.link).join('\n')).join('\n\n')}

Verify package, functionality, electrical specs, and rank the top 3 alternatives with reasoning. Format as numbered sections with clear headings and bullet points.`
      }
    ];
    const verifiedMarkdown = await fetchOpenAI(verificationPrompt);
    const verifiedHTML = marked(verifiedMarkdown).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

    // Return results
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalPart: partNumber,
        originalSearchResults,
        candidateParts,
        candidateSearchResults,
        verifiedAlternatives: {
          markdown: verifiedMarkdown,
          html: verifiedHTML
        }
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Server error' }) };
  }
};
