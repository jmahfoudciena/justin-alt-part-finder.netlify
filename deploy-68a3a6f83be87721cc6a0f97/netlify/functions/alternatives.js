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

		const prompt = `I need to find alternatives for the electronic component part number: ${partNumber}. 
		
Please provide me with:
1. A brief description of what this component is and include the package type. Verify the package type explicitly from the manufacturer's datasheet or distributor platforms like Digi-Key or Mouser. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed. Avoid assumptions and verify the package information and ordering information in the datasheets for most accurate package information.
2. Please provide 10 alternative part numbers that could serve as replacements for the original component. These alternatives must be:
	- Sorted by similarity, with the most similar listed first.
	- Similarity is determined by:
		- Functionality match: The alternate must perform the same core function as the original (e.g., if the original is a zero-delay buffer with 8 output channels, the alternate must also be a zero-delay buffer with 8 output channels).
		- Package compatibility: The alternate must use the same package type (e.g., TSSOP-16) or have an identical footprint and pinout.
	- Functional Matching Rules
		- Alternates must match the functional category and key specs of the original part. Do not rely solely on distributor or manufacturer category labels, as these may differ. Instead, verify functionality directly from datasheet keywords (e.g., ‘zero delay,’ ‘PLL,’ ‘fanout buffer,’ output count, package type). Include any part that is functionally equivalent, even if grouped under a different product category such as ‘SDRAM buffer,’ ‘clock tree,’ or ‘fanout buffer.. Examples include:
			- If the original part is a zero-delay buffer with 8 output channels, the alternate must also be a zero-delay buffer with 8 output channels.
			- If the original part is a 4 Kb SPD EEPROM, the alternate must also be a 4 Kb SPD EEPROM.
			- If the original part is a 3.3V LVCMOS clock driver, the alternate must also be a 3.3V LVCMOS clock driver.
			- If the original part is a voltage regulator, the alternate must match the output voltage, current rating, and regulation type (e.g., LDO vs switching).

		- The alternate must use the same package type (e.g., TSSOP-16, SOIC-8, QFN-32).
			- If no package-compatible alternatives exist, functionally similar parts may be suggested, but must be clearly marked as requiring PCB or firmware changes.
3. For each alternative, include:
   - Part number
   - Brief description of key specifications. Be sure to include the package type and verify it from the manufacturer's datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed.
   - Any notable differences from the original part
   - Manufacturer name if known. Do not limit to manufacturer of original part.
   - List if the alternate part matches the functionality and the package of the original part
4. If no alternatives are package-compatible, explicitly state this and suggest options that are functionally similar but require changes to the PCB or firmware.
5. Include a **Summary and Conclusion** section:
   - **Summary:** Provide a clear overview of the findings, highlighting whether package-compatible alternatives exist or if PCB modifications are required. Include package-compatible alternatives and functionally similar alternatives. 
   - **Conclusion:** Offer actionable insights, such as whether redesigning the PCB or adapting firmware is necessary and which alternatives are most suitable based on the findings.


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
