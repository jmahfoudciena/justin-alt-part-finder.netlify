const fetch = require('node-fetch');
const { marked } = require('marked');
const pdfParse = require('pdf-parse');

marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

// Google search helper (PDFs only)
async function googleSearch(partNumber) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CX;
  if (!googleKey || !googleCx) throw new Error('Missing GOOGLE_API_KEY or GOOGLE_CX');

  const query = `${partNumber} datasheet filetype:pdf site:ti.com OR site:st.com OR site:digikey.com OR site:mouser.com`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&num=6&q=${encodeURIComponent(query)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google Search API error: ${resp.status}`);
  const data = await resp.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.filter(it => it.link.endsWith('.pdf'));
}

// Fetch & extract PDF text safely
async function fetchDatasheetText(pdfUrl) {
  if (!pdfUrl) return '';
  try {
    const resp = await fetch(pdfUrl);
    if (!resp.ok) throw new Error(`PDF fetch failed: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const pdfData = await pdfParse(Buffer.from(buffer));
    return pdfData.text.slice(0, 4000); // Keep small to avoid token overload
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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

    const { partA, partB } = JSON.parse(event.body || '{}');
    if (!partA || !partB) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both partA and partB are required' }) };

    // Search PDFs
    const [searchA, searchB] = await Promise.all([googleSearch(partA), googleSearch(partB)]);
    const pdfA = searchA[0]?.link || '';
    const pdfB = searchB[0]?.link || '';
    console.log('PDF URLs:', pdfA, pdfB);

    // Extract datasheet text
    const [textA, textB] = await Promise.all([fetchDatasheetText(pdfA), fetchDatasheetText(pdfB)]);
    console.log('Extracted text lengths:', textA.length, textB.length);

    // Prepare prompt
    const systemPrompt = "You are an expert electronics engineer and component librarian specializing in detailed component analysis.";
    const userPrompt = `
Compare **${partA}** vs **${partB}**.

PDF Datasheets:
${partA}: ${pdfA}
${partB}: ${pdfB}

Extracted datasheet text:
${partA}:
${textA}

${partB}:
${textB}

Provide:
1. Overview table
2. Electrical specs
3. Register/Firmware comparison
4. Package & footprint (pinouts, mismatches)
5. Drop-in compatibility assessment
6. Recommendations

Only use verified info from datasheets, highlight uncertainties, and be extremely accurate.
`;

    // Call OpenAI
    let openaiData;
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 16000,
          temperature: 0.2
        })
      });
      openaiData = await resp.json();
    } catch (err) {
      console.error('OpenAI fetch error:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'OpenAI fetch failed' }) };
    }

    const markdownContent = openaiData?.choices?.[0]?.message?.content || '';
    if (!markdownContent) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Empty response from model' }) };

    const htmlContent = marked(markdownContent)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<table/g, '<table class="comparison-table"')
      .replace(/<tr/g, '<tr class="comparison-row"')
      .replace(/<td/g, '<td class="comparison-cell"')
      .replace(/<th/g, '<th class="comparison-header"');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        html: htmlContent,
        raw: markdownContent,
        datasheetLinks: { partA: pdfA, partB: pdfB }
      })
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Server error' }) };
  }
};
