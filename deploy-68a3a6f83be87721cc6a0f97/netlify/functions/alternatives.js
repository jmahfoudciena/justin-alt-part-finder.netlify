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
   • Provide a short description of the original component, including its main function and key specifications.
   • Verify the package type using both:
       ◦ Official datasheet (Features, Description, Ordering Information)
       ◦ Distributor listing (Digi-Key or Mouser)
       ◦ Do not assume or invent package. Exclude if package cannot be confirmed.
   • Verify core electrical specifications (voltage, current, frequency, timing, power) from datasheet, and cite sections.
   • Verify the pinout matches the original part.
   • Provide current unit price from Digi-Key or Mouser with citation.
   • Provide lifecycle status (Active, NRND, Last Time Buy).

2. Alternatives Search
   • Identify 3 alternative components from reputable semiconductor manufacturers (TI, ADI, NXP, ON Semi, Microchip, etc.).
   • Prioritize alternatives that are **functionally equivalent and package-compatible** with the original part.
   • Confirm availability and lifecycle using Digi-Key or Mouser. Acceptable: Active, NRND, Last Time Buy. Exclude obsolete parts.
   • Verify package type, pinout, and core electrical specs from datasheet.
   • Verify functionality using datasheet keywords (e.g., PLL, zero delay, fanout buffer, output count, interface type, voltage/current range).
   • Provide price per unit with distributor citation.
   • Include any differences or deviations from the original (footprint, electrical, interface, software considerations).
   • Include confidence level (High / Medium / Low).

3. Output Format
   • Manufacturer & Part Number (include variant/suffix if used)
   • Short description (function + key specs)
   • Core electrical specifications
   • Package type (with datasheet & distributor citation)
   • Pinout compatibility
   • Lifecycle status (cite distributor)
   • Notes on compatibility
   • Price per unit (with link)
   • Confidence level
   • Deviations from original

4. Ranking
   • Rank the 3 alternatives by closeness to the original part using these priorities:
       1. Package match
       2. Functional match
       3. Lifecycle status
       4. Distributor availability
       5. Price competitiveness
   • Include rationale for ranking.

5. Summary & Conclusion
   • Provide a clear overview of findings, highlighting whether package-compatible alternatives exist or if PCB/firmware adaptations are required.
   • Recommend the most suitable alternatives with reasoning.
   • Include date of availability verification for all parts.

Ensure all information is accurate, cited from datasheets or distributor listings, and avoid inventing parts, packages, or specifications. Always prioritize **functionally equivalent, package-compatible alternates** when available.`;

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
						content: 'You are a helpful electronics engineer who specializes in finding component alternatives. Provide accurate, practical alternatives with clear specifications. The alternatives should be package and footprint compatible with similar electrical and timing specifications and if applicable, firmware/register similarities.'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				max_tokens: 1000
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
