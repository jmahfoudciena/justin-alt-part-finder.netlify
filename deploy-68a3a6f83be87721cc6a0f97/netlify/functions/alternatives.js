const { marked } = require('marked');

// Configure marked for security and proper rendering
marked.setOptions({
	breaks: true,
	gfm: true,
	sanitize: false,
	headerIds: true,
	mangle: false
});

exports.handler = async (event, context) => {
	// Handle CORS
	const headers = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS'
	};

	// Handle OPTIONS request for CORS preflight
	if (event.httpMethod === 'OPTIONS') {
		return {
			statusCode: 200,
			headers,
			body: ''
		};
	}

	// Only allow POST requests
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
				body: JSON.stringify({ error: 'Server is not configured with OPENAI_API_KEY' })
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

const prompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.

Follow these requirements carefully:
1. Original Part Verification
• Short Description: Provide a concise summary of the original component’s function and key specifications.
• Package Type Verification:
  - You must confirm the package type using:
		Authorized Distributors 
        - Use Digi-Key
       	- Verify BOTH “Package / Case” AND “Supplier Device Package.”
       	- Extract the package type, pin count, and dimensions.
 No assumptions.
  - Consistency Rules:
    - Do not assume family parts share the same package; only confirm from “Package / Case” AND “Supplier Device Package”.
    - Do not invent, infer, or guess.
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
					{
						role: 'system',
						content: 'You are a helpful electronics engineer who specializes in finding component alternatives. Provide accurate, practical alternatives with clear specifications.'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				//max_completion_tokens: 4096
				
			})
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
		}

		const data = await response.json();
		
		if (!data.choices || !data.choices[0] || !data.choices[0].message) {
			throw new Error('Unexpected API response structure');
		}
		
		// Convert markdown to HTML
		const markdownContent = data.choices[0].message.content;
		const htmlContent = marked(markdownContent);
		
		return {
			statusCode: 200,
			headers,
			body: JSON.stringify({ alternatives: htmlContent })
		};
	} catch (error) {
		return {
			statusCode: 500,
			headers,
			body: JSON.stringify({ error: error.message || 'Server error' })
		};
	}
};
