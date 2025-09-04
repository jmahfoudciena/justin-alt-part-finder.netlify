const fetch = require('node-fetch');
const { marked } = require('marked');
const pdfParse = require('pdf-parse'); // 🔥 PDF parser

marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

// Google Custom Search helper
async function googleSearch(partNumber) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CX;

  const query = `${partNumber} datasheet filetype:pdf site:ti.com OR site:st.com OR site:digikey.com OR site:mouser.com OR site:arrow.com`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&num=6&q=${encodeURIComponent(query)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google Search API error: ${resp.status}`);
  const data = await resp.json();

  const items = Array.isArray(data.items) ? data.items : [];
  return items.filter(it => it.link.endsWith('.pdf')); // ✅ only PDFs
}

// Download and extract PDF text
async function fetchDatasheetText(pdfUrl) {
  try {
    const resp = await fetch(pdfUrl);
    if (!resp.ok) throw new Error(`PDF fetch failed: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const pdfData = await pdfParse(Buffer.from(buffer));
    return pdfData.text.slice(0, 5000); // ⚠️ keep under GPT token limit
  } catch (err) {
    console.warn(`Failed to parse PDF ${pdfUrl}:`, err.message);
    return '';
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const { partA, partB } = JSON.parse(event.body || '{}');

    // 🔎 Search for PDFs
    const [searchA, searchB] = await Promise.all([
      googleSearch(partA),
      googleSearch(partB)
    ]);

    const pdfA = searchA[0]?.link || '';
    const pdfB = searchB[0]?.link || '';

    // 📑 Extract datasheet text
    const [textA, textB] = await Promise.all([
      pdfA ? fetchDatasheetText(pdfA) : '',
      pdfB ? fetchDatasheetText(pdfB) : ''
    ]);

    // System + user prompts
    const systemPrompt = "You are an expert electronics engineer...";
    const userPrompt = `
Compare **${partA}** vs **${partB}**

Datasheet for ${partA}: ${pdfA}
Datasheet for ${partB}: ${pdfB}

### Extracted Datasheet Snippets:
${partA} Datasheet:
${textA}

${partB} Datasheet:
${textB}

Please create tables for:
1. Overview
2. Electrical specs
3. Register/firmware
4. Package & footprint (pinouts, mismatches)
5. Drop-in compatibility assessment
6. Recommendations
`;

    // 🔮 Call OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 4096,
        temperature: 0.2
      })
    });

    const data = await response.json();
    const markdownContent = data?.choices?.[0]?.message?.content || '';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        html: marked(markdownContent),
        raw: markdownContent,
        datasheetLinks: { partA: pdfA, partB: pdfB }
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
