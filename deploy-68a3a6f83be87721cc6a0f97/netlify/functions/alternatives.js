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
   • Provide a short description of the original component (its main function and key specifications).
   • Verify the package type by checking both:
       ◦ The official datasheet (Features, Description, and Ordering Information sections)
       ◦ A distributor listing (such as Digi-Key or Mouser)
       ◦ Do not invent or assume package. If Supplier Device Package cannot be confirmed on Digi-Key or Mouser, do not include it in the results.
   • Clearly cite the datasheet section and/or distributor page where the package information is confirmed.
   • Provide the current unit price from Digi-Key or Mouser (cite distributor).

2. Alternatives Search
   • Identify 3 alternative components from other reputable semiconductor manufacturers. Each alternate must be listed on Digi-Key with an orderable Manufacturer Product Number or a confirmed variant of the base part number (e.g., suffixes like -DGGR, -DW) that is functionally equivalent.
   • If the base manufacturer part number is not orderable on Digi-Key, include purchasable variants or suffixes that are verified in the datasheet to be functionally identical and package-compatible.
   • Confirm availability and lifecycle status using distributor listings (Digi-Key or Mouser only). Acceptable lifecycle statuses: Active, NRND, or Last Time Buy. Exclude obsolete parts. Clearly disclose if the part is not Active.
   • Each alternative must be functionally identical or very close in purpose (perform the same role, with comparable electrical ranges and interface). Verify functionality using datasheet keywords (e.g., 'zero delay', 'PLL', 'fanout buffer', output count, package type), regardless of distributor category grouping.
   • Prioritize alternatives that match both **functionality** and **package type**. Include parts that match the datasheet even if distributor does not explicitly list them as alternates.
   • Verify package and key features for each alternate using:
       ◦ The official datasheet (Features, Description, Ordering Information)
       ◦ Distributor listings for lifecycle status, pricing, and availability.
   • Provide the current unit price from Digi-Key or Mouser for each alternative (cite distributor).

3. Output Format (for original + alternatives)
   • Manufacturer & Part Number (include variant/suffix if used)
   • Short description (function + key specifications)
   • Package type (with citation from datasheet ordering section and distributor)
   • Lifecycle status (Active, NRND, Last Time Buy — exclude obsolete; cite distributor or manufacturer)
   • Notes on compatibility (footprint identical, package differs, electrical/software considerations)
   • Price per unit (with source: Digi-Key or Mouser)

4. Ranking
   • Rank the 3 alternatives by closeness to the original part using this priority:
       1. Package match or closest equivalent
       2. Functional match (role, features, electrical/spec similarity)
       3. Lifecycle status
       4. Distributor availability
       5. Price competitiveness

5. Include a Summary and Conclusion section:
   • Summary: Provide a clear overview of the findings, highlighting whether package-compatible alternatives exist or if PCB modifications are required. Include package-compatible alternatives and functionally similar alternatives.
   • Conclusion: Offer actionable insights, such as whether redesigning the PCB or adapting firmware is necessary and which alternatives are most suitable based on the findings.

IMPORTANT: Make each alternative visually distinct and easy to separate. Use clear section breaks, numbered lists, or visual separators between each alternative. Consider using:
- Clear numbered sections (1., 2., 3.)
- Horizontal rules (---) between alternatives
- Distinct headings for each alternative
- Bullet points with clear spacing

Format the response in clear markdown with proper headings, bullet points, and visual separation between alternatives.`;

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
