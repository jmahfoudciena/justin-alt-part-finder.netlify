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

    // --- Step 1: Google Search ---
    let searchResults = [];
    let googleData = null;

    if (googleKey && googleCx) {
      const query = `${partNumber} site:digikey.com`;
      const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&q=${encodeURIComponent(query)}`;
      const googleResp = await fetch(googleUrl);

      if (googleResp.ok) {
        googleData = await googleResp.json();
        searchResults = (googleData.items || [])
          .filter(item => item.link.includes('digikey.com'))
          .slice(0, 3)
          .map(item => item.link);
      } else {
        console.warn('Google Search request failed:', googleResp.statusText);
      }
    }

    if (searchResults.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No Digi-Key links found' }) };
    }

    // --- Step 2: Scrape Digi-Key pages ---
    let packageInfoList = [];

    for (const url of searchResults) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;

        const html = await resp.text();
        const $ = cheerio.load(html);

        let packageType = $('table[data-testid="product-details-specs"] tr')
          .filter((i, el) => $(el).find('th').text().trim() === 'Package / Case')
          .find('td')
          .text()
          .trim();

        let supplierPackage = $('table[data-testid="product-details-specs"] tr')
          .filter((i, el) => $(el).find('th').text().trim() === 'Supplier Device Package')
          .find('td')
          .text()
          .trim();

        if (packageType || supplierPackage) {
          packageInfoList.push({
            url,
            packageType: packageType || 'N/A',
            supplierPackage: supplierPackage || 'N/A'
          });
        }
      } catch (err) {
        console.warn('Failed to fetch/parse Digi-Key page:', url, err.message);
      }
    }

    // --- Step 3: Build GPT prompt ---
    const prompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.

Here is the package info extracted from Digi-Key:
${packageInfoList.length > 0 ? JSON.stringify(packageInfoList, null, 2) : "[No package info found]"}

Follow these requirements carefully:
1. Original Part Verification
• Short Description: Provide a concise summary of the original component’s function and key specifications.
• Package Type: Use package / case extracted from the Google Custom Search
• Core Electrical Specs: Verify voltage, current, frequency, timing, and power from the datasheet. Cite relevant sections.
• Pinout Verification: Confirm pinout from datasheet.
• Block Diagram Summary: Analyze internal functional blocks (e.g., PLL, MUX, Buffers, ADC, interfaces). Cite datasheet section.
• Price & Lifecycle: Provide current unit price from Digi-Key or Mouser. Confirm lifecycle status (Active, NRND, Last Time Buy).
2. Alternatives Search
• Identify 3 Alternatives:
  - From reputable manufacturers (e.g., TI, ADI, NXP, ON Semi, Microchip)
  - Prioritize parts that are functionally equivalent and package-compatible
  - Hint: Sometimes alternates will have similar part numbers. For instance, STTS2004B2DN3F is alternate for AT30TSE004A. Both have 004 in their part number. Use this information to find alternates. 
• Industry-Preferred Equivalents: Always include known industry-preferred equivalents if they meet functional and package criteria.
• Package Variant Awareness: Check if multiple package variants exist (e.g., SOIC, TSSOP). Include compatible variants even if not listed in the original query.
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
   - Manufacturer name if known. Do not limit to manufacturer of original part.
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

    // --- Step 4: Call OpenAI ---
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful electronics engineer who specializes in finding component alternatives.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 16384
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const markdownContent = data.choices?.[0]?.message?.content || '';
    const htmlContent = marked(markdownContent);

    return { statusCode: 200, headers, body: JSON.stringify({ alternatives: htmlContent, raw: markdownContent, packageInfoList }) };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Server error' }) };
  }
};
