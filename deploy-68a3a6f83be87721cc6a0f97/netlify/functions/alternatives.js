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
   • Verify the package type by checking both:
       ◦ The official datasheet (Features, Description, Ordering Information sections)
       ◦ A distributor listing (Digi-Key or Mouser)
       ◦ Do not invent or assume package. If Supplier Device Package cannot be confirmed on Digi-Key or Mouser, exclude it.
   • Verify core electrical specifications (e.g., voltage, current, frequency, timing, power) from the datasheet, and explicitly cite the datasheet sections.
   • Verify the pinout matches the original (from datasheet).
   • Provide current unit price from Digi-Key or Mouser, with a direct citation/link.
   • Include the lifecycle status (Active, NRND, Last Time Buy) from the distributor.

2. Alternatives Search
   • Identify 3 alternative components from reputable semiconductor manufacturers (e.g., TI, Analog Devices, NXP, ON Semi, Microchip). Each must be listed on Digi-Key or Mouser with an orderable Manufacturer Product Number or verified variant/suffix that is functionally equivalent.
   • Confirm availability and lifecycle status using distributor listings. Acceptable statuses: Active, NRND, or Last Time Buy. Exclude obsolete parts. Clearly disclose if the part is not Active.
   • Prioritize alternatives that match both **functionality** and **package type**. If a perfect match does not exist, note differences and required adaptations (PCB, firmware, or electrical).
   • Verify:
       ◦ Core electrical specs from datasheet (voltage, current, frequency, timing)
       ◦ Pinout compatibility
       ◦ Package type (cite datasheet Ordering Info section)
       ◦ Functionality keywords (e.g., PLL, zero delay, fanout buffer, output count)
   • Provide current unit price from Digi-Key or Mouser with citation/link.
   • Include any minor differences or deviations from the original (footprint, electrical range, interface, software considerations).
   • Include confidence level in suitability (High / Medium / Low).

3. Output Format (for original + alternatives)
   • Manufacturer & Part Number (include variant/suffix if used)
   • Short description (function + key specifications)
   • Core electrical specifications (voltage, current, frequency, timing)
   • Package type (with datasheet and distributor citations)
   • Pinout compatibility confirmation
   • Lifecycle status (Active, NRND, Last Time Buy — cite distributor)
   • Notes on compatibility (footprint identical, package differs, electrical/software considerations)
   • Price per unit (with source link)
   • Confidence level (High / Medium / Low)
   • Any deviations from original

4. Ranking
   • Rank the 3 alternatives by closeness to the original part using these priorities:
       1. Package match or closest equivalent
       2. Functional match (role, features, electrical/spec similarity)
       3. Lifecycle status
       4. Distributor availability
       5. Price competitiveness
   • Include a brief rationale for ranking.

5. Summary and Conclusion
   • Summary: Provide a clear overview of findings, highlighting whether package-compatible alternatives exist, or if PCB/firmware adaptations are required.
   • Conclusion: Offer actionable insights on whether redesigning PCB, adapting firmware, or minor adjustments are necessary. Recommend the most suitable alternatives based on package, functionality, lifecycle, and availability.
   • Include date of availability verification for all parts.

Ensure all information is accurate, cited from official datasheets or distributor listings, and avoid inventing part numbers, packages, or specifications.`;

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
