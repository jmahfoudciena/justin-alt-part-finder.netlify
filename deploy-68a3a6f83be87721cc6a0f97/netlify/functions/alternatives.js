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

// Helper: Google Custom Search
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

    // 1) Google search
    let searchItems = [];
    let searchSummary = 'No search results found.';
    try {
      searchItems = await googleSearch(partNumber);
      if (searchItems.length) {
        searchSummary = searchItems
          .slice(0, 6)
          .map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.link}\n${r.snippet}`)
          .join('\n\n');
      }
    } catch (e) {
      console.warn('Google search failed, continuing without results:', e.message);
    }

    // 2) OpenAI prompt
    const userPrompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.
	Use the following web search results as context for the original part only:${searchSummary}
 	
  Follow these requirements carefully:
1. Original Part Verification
• Short Description: Provide a concise summary of the original component’s function and key specifications Using the following web search results as context for the original part only:${searchSummary}
• Package Type Verification Using the following web search results as context for the original part only:${searchSummary}:
 No assumptions.
  - Consistency Rules:
    - Do not assume family parts share the same package; only confirm from “Package / Case” AND “Supplier Device Package”.
    - Do not invent, infer, or guess.
• Core Electrical Specs: Verify voltage, current, frequency, timing, and power from the datasheet. Using the following web search results as context for the original part only:${searchSummary}.
• Pinout Verification: Confirm pinout from datasheet Using the following web search results as context for the original part only:${searchSummary}.
• Block Diagram Summary: Analyze internal functional blocks (e.g., PLL, MUX, Buffers, ADC, interfaces). Using the following web search results as context for the original part only:${searchSummary}.
• Price & Lifecycle: Provide current unit price from Digi-Key or Mouser. Confirm lifecycle status (Active, NRND, Last Time Buy) Using the following web search results as context for the original part only:${searchSummary}.
2. Alternatives Search. Use short description, functionality and package of the original part to search for altnernate parts.
• Identify 3 Alternatives:
  - From reputable manufacturers (e.g., TI, ADI, NXP, ON Semi, Microchip)
  - Alternate part must not be from the same manufacturer as the original part. **important**
  - Prioritize parts that are functionally equivalent and package-compatible
• Industry-Preferred Equivalents: Always include known industry-preferred equivalents if they meet functional and package criteria.
• Verification Requirements:
  - Confirm lifecycle status (Active, NRND, Last Time Buy)
  - Verify package type, pinout, and core electrical specs from datasheet
  - Analyze block diagrams or functional descriptions and compare to original
  - Confirm functionality using datasheet keywords (PLL, zero delay, fanout buffer, output count, interface type, voltage/current range)
  - Provide price per unit with distributor citation
  - Note any differences (footprint, electrical, interface, software)
  - Include confidence level (High / Medium / Low)
3. For each alternative, include:
   - Part number
   - Brief description of key specifications. Be sure to include the package type and verify it from the manufacturer's datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed.
   - Any notable differences from the original part
   - Manufacturer name if known. 
   - List if the alternate part matches the functionality and the package of the original part
   - Price per Unit (with link)
   - Confirmed Package Type (from datasheet ordering code + at least one distributor listing). Cite exact table/section or distributor field. If not verifiable, state “Package type cannot be confirmed” and exclude.
4. Ranking
Rank the 3 alternatives by closeness to the original part using these priorities:
1. Package Match
2. Functional Match, including block diagram similarity
3. Lifecycle Status
4. Distributor Availability
5. Price Competitiveness
If a verified preferred alternate exists, list it first and explain any minor deviations. Include rationale for ranking.
5. Summary & Conclusion
• Provide a clear overview of findings.
• Highlight whether package-compatible alternatives exist or if PCB/firmware adaptations are required.
• Explicitly note differences in functional blocks that may affect compatibility.
• Recommend the most suitable alternatives with reasoning.
• Include date of availability verification for all parts.
   
IMPORTANT: Make each alternative visually distinct and easy to separate. Use clear section breaks, numbered lists, or visual separators between each alternative. Consider using:
- Clear numbered sections (1., 2., 3.)
- Horizontal rules (---) between alternatives
- Distinct headings for each alternative
- Bullet points with clear spacing

Ensure all information is accurate, cited from datasheets or distributor listings, and avoid inventing parts, packages, or specifications. Prioritize functionally equivalent, package-compatible alternates, using block diagram comparison to verify internal functionality.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful electronics engineer specializing in finding component alternatives.' },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 8000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
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
