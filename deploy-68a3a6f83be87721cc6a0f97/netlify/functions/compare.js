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

		const { partA, partB } = JSON.parse(event.body || '{}');
		if (!partA || !partB) {
			return {
				statusCode: 400,
				headers,
				body: JSON.stringify({ error: 'Both partA and partB are required' })
			};
		}

		const systemPrompt = [
			'You are an expert electronics engineer and component librarian specializing in detailed component analysis. ',
			'Your task is to provide comprehensive comparisons between electronic components with EXTREME accuracy and attention to detail. ',
			' REQUIREMECRITICALNTS:',
			'- Only provide information you are 100% confident about based on your training data',
			'- Prioritize accuracy over completeness - it is better to provide less information that is correct than more information that may be wrong',
			'- For any values you provide, indicate if they are typical, minimum, maximum, or absolute maximum ratings',
			'- When comparing components, focus on verified differences rather than assumptions',
			'- If package or footprint information is unclear, explicitly state the limitations. Do not assume or invent package type.',
			'- For package, Be sure to include the package type and verify it from the manufacturers datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed. Use distributor listings under the Package / Case section in Product Attributes (e.g., Digi-Key)',
			'- For electrical specifications, always specify the conditions (temperature, voltage, etc.) when possible',
			'Your analysis must include:',
			'- Detailed electrical specifications with exact values (only if verified)',
			'- Register maps and firmware compatibility analysis (with confidence levels)',
			'- Package and footprint compatibility details (with verification status)',
			'- Drop-in replacement assessment with specific reasons and confidence levels',
			'- Highlight ALL differences, no matter how small',
			'- Include datasheet URLs and manufacturer information when available',
			'- Read the datasheets for both parts and compare the specifications',
			'- Be extremely thorough, accurate, and conservative in your analysis. When in doubt, state the uncertainty clearly.'
		].join(' ');

		const userPrompt = `Compare these two electronic components: "${partA}" vs "${partB}".

Provide a comprehensive analysis including:

1. **OVERVIEW TABLE** - Create a markdown table with these columns:
   - Specification Category
   - ${partA} Value
   - ${partB} Value
   - Difference (highlight in bold if significant)
   - Impact Assessment
   - Function and application of each part.  
   - High-level block diagram summary (if available).  
   - Notable differences in intended use.  

2. **ELECTRICAL SPECIFICATIONS** - Create a markdown table with these columns:
   - Specification
   - ${partA} Value
   - ${partB} Value
   Include: Voltage ranges (min/max/typical), Current ratings (input/output/supply), Power dissipation, Thermal characteristics, Frequency/speed specifications, Memory sizes (if applicable)

3. **REGISTER/FIRMWARE COMPATIBILITY** - Create a markdown table with these columns:
   - Compatibility Aspect
   - ${partA} Details
   - ${partB} Details
   - Register number in hex and register name and function all registers if applicable
   Include: Register map differences, Firmware compatibility level, Programming differences, Boot sequence variations, Memory organization

4. **PACKAGE & FOOTPRINT** - Create a markdown table with these columns:
   - Physical Characteristic
   - ${partA} Specification
   - ${partB} Specification
   Include: Package dimensions, Materials, Pin count and spacing, Mounting requirements, Thermal pad differences, Operating temperature range. Side-by-side pinout comparison:  
       ◦ Table format listing Pin Number, Pin Name/Function for both Part A and Part B. List all pins.  
       ◦ Explicitly mark mismatches.  
	   ◦ This information should be taken out of manufactuer datasheet . Do not assume. Never invent. 

5. **DROP-IN COMPATIBILITY ASSESSMENT**:
   - Overall compatibility score (0-100%)
   - Specific reasons for incompatibility
   - Required modifications for replacement
   - Risk assessment

6. **RECOMMENDATIONS**:
   - When to use each part
   - Migration strategies
   - Alternative suggestions

**CRITICAL ACCURACY REQUIREMENTS:**
- Only provide specifications you are 100% confident about
- For electrical values, always specify if they are min/max/typical/absolute max
- Include confidence levels for each comparison section
- When in doubt about compatibility, state the uncertainty clearly

Format the response in clean markdown with proper tables, code blocks for ASCII art, and ensure all differences are clearly highlighted. Be extremely detailed, thorough, and ACCURATE in your analysis. Prioritize correctness over completeness.`;

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				],
				max_tokens: 4000,
				temperature: 0.2
			})
		});

		if (!response.ok) {
			const err = await response.json().catch(() => ({}));
			return {
				statusCode: response.status,
				headers,
				body: JSON.stringify({ error: err.error?.message || 'OpenAI API error' })
			};
		}

		const data = await response.json();
		const markdownContent = data?.choices?.[0]?.message?.content || '';
		if (!markdownContent) {
			return {
				statusCode: 502,
				headers,
				body: JSON.stringify({ error: 'Empty response from model' })
			};
		}

		// Convert markdown to HTML
		const htmlContent = marked(markdownContent);
		
		// Enhanced safety: strip script tags and add custom CSS classes
		const safeHtml = htmlContent
			.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
			.replace(/<table/g, '<table class="comparison-table"')
			.replace(/<tr/g, '<tr class="comparison-row"')
			.replace(/<td/g, '<td class="comparison-cell"')
			.replace(/<th/g, '<th class="comparison-header"');

		return {
			statusCode: 200,
			headers,
			body: JSON.stringify({ html: safeHtml })
		};
	} catch (error) {
		return {
			statusCode: 500,
			headers,
			body: JSON.stringify({ error: error.message || 'Server error' })
		};
	}
};
