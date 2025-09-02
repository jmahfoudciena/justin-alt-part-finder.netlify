const fetch = require('node-fetch');
const { marked } = require('marked');

// Configure marked
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

  // Handle OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Missing OPENAI_API_KEY' })
      };
    }

    const { partNumber } = JSON.parse(event.body || '{}');
    if (!partNumber) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Part number is required' })
      };
    }

    //
    // Step 1 — Package Verification
    //
    const packagePrompt = `
You are an expert electronic component librarian.
Verify the package type of the part number: ${partNumber}.

STRICT RULES:
1. Always start with the manufacturer’s datasheet for the EXACT part number.
   - Extract ordering code mapping → package type, pin count, dimensions.
   - If datasheet confirmation fails, return PACKAGE_UNVERIFIED immediately.
2. Cross-check with at least TWO authorized distributors (Digi-Key, Mouser, Arrow, Avnet).
   - Record BOTH “Package / Case” and “Supplier Device Package.”
   - Must match datasheet exactly.
3. Consistency:
   - Datasheet pin count must equal distributor pin count.
   - Package names must match exactly (SOIC-8 ≠ SOP-8 unless explicitly equivalent).
4. NEVER guess, assume, or use family similarity.
   - If any step fails → return PACKAGE_UNVERIFIED.

OUTPUT FORMAT: JSON ONLY
{
  "part_number": "${partNumber}",
  "datasheet_verification": {
    "ordering_code_reference": "<ordering code or UNVERIFIED>",
    "package_type": "<package name or UNVERIFIED>",
    "pin_count": "<number or UNVERIFIED>",
    "dimensions": "<value or UNVERIFIED>"
  },
  "distributor_verification": [
    {
      "distributor": "Digi-Key",
      "package_case": "<value or UNVERIFIED>",
      "supplier_device_package": "<value or UNVERIFIED>"
    },
    {
      "distributor": "Mouser",
      "package_case": "<value or UNVERIFIED>",
      "supplier_device_package": "<value or UNVERIFIED>"
    }
  ],
  "final_result": "PACKAGE_CONFIRMED or PACKAGE_UNVERIFIED",
  "reason": "<clear explanation>"
}`;

    const verifyResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a strict package verification assistant. Output JSON only.' },
          { role: 'user', content: packagePrompt }
        ],
        temperature: 0,
        response_format: { type: "json_object" }
      })
    });

    const verifyData = await verifyResponse.json();
    const verification = JSON.parse(verifyData.choices[0].message.content);

    if (verification.final_result === "PACKAGE_UNVERIFIED") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ verification })
      };
    }

    //
    // Step 2 — Alternatives Search (only if package confirmed)
    //
    const altPrompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.

Follow these requirements carefully:
1. Original Part Verification
• Short Description: Provide a concise summary of the original component’s function and key specifications.
• Package Type Verification:
  - Package Type Verification Rules
	1. Primary Source – Datasheet Check
		- Always start with the manufacturer’s datasheet for the exact part number.
		- Decode the ordering code to confirm:
			- Package type (e.g., QFN-32, SOIC-8, BGA-96)
			- Pin count
			- Mechanical dimensions
		- If the datasheet does not explicitly list package details, mark as unverified and stop.
	2. Secondary Source – Distributor Cross-Check
		- Use at least two authorized distributors (Digi-Key, Mouser, Arrow, Avnet, etc.).
		- On distributor product pages, verify both fields:
			- Package / Case
			- Supplier Device Package
		- These must exactly match the datasheet.
	3. Consistency Rules
		- Pin count in distributor listings must match datasheet pin count.
		- Do not assume that parts with the same prefix (family parts) have the same package.
		- Only use ordering code + datasheet confirmation, never inference.
	4. Fail Condition
		- If datasheet package cannot be confirmed or distributors show inconsistent/unknown packages, return:
		- Result: Package type cannot be confirmed. Exclude this part.
	IMPORTANT: Never invent or guess a package type.
• Core Electrical Specs: Verify voltage, current, frequency, timing, and power from the datasheet. Cite relevant sections.
• Pinout Verification: Confirm pinout from datasheet.
• Block Diagram Summary: Analyze internal functional blocks (e.g., PLL, MUX, Buffers, ADC, interfaces). Cite datasheet section.
• Price & Lifecycle: Provide current unit price from Digi-Key or Mouser. Confirm lifecycle status (Active, NRND, Last Time Buy).
2. Alternatives Search
• Identify 3 Alternatives:
  - From reputable manufacturers (e.g., TI, ADI, NXP, ON Semi, Microchip)
  - Prioritize parts that are functionally equivalent and package-compatible
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
   - List if the alternate part matches the functionality and the package of the original part• Price per Unit (with link)
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

    const altResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful electronics engineer who specializes in finding component alternatives.' },
          { role: 'user', content: altPrompt }
        ],
        max_tokens: 16384
      })
    });

    const altData = await altResponse.json();
    const markdownContent = altData.choices[0].message.content;
    const htmlContent = marked(markdownContent);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        verification,
        alternatives: htmlContent
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Server error' })
    };
  }
};
