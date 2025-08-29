const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');
const { marked } = require('marked');
require('dotenv').config();

// Configure marked for security and proper rendering
marked.setOptions({
	breaks: true, // Convert line breaks to <br>
	gfm: true, // GitHub Flavored Markdown
	sanitize: false, // We'll handle sanitization ourselves
	headerIds: true,
	mangle: false
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			defaultSrc: ["'self'"],
			styleSrc: ["'self'", "'unsafe-inline'"],
			scriptSrc: ["'self'"],
			connectSrc: ["'self'", "https://api.openai.com"]
		}
	}
}));

// Enable CORS for company network access
app.use(cors({
	origin: true,
	credentials: true
}));

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Main route
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'index.html'));
});



// Health check endpoint
app.get('/health', (req, res) => {
	res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Part alternatives API (moved from script.js)
app.post('/api/alternatives', async (req, res) => {
	try {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			return res.status(500).json({ error: 'Server is not configured with OPENAI_API_KEY' });
		}

		const { partNumber } = req.body || {};
		if (!partNumber) {
			return res.status(400).json({ error: 'Part number is required' });
		}

		const prompt = `I need to find alternatives for the electronic component part number: ${partNumber}. 
		
Please provide me with:
1. A brief description of what this component is and include the package type. Verify the package type explicitly from the manufacturer's datasheet or distributor platforms like Digi-Key or Mouser. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed. Avoid assumptions and verify the package information and ordering information in the datasheets for most accurate package information.
2. Please provide 5 alternative part numbers that could serve as replacements for the original component. These alternatives must be:
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
				max_tokens: 16384
			})
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
		}

		const data = await response.json();
		
		// Check if the response has the expected structure
		if (!data.choices || !data.choices[0] || !data.choices[0].message) {
			throw new Error('Unexpected API response structure');
		}
		
		// Convert markdown to HTML
		const markdownContent = data.choices[0].message.content;
		const htmlContent = marked(markdownContent);
		
		return res.json({ alternatives: htmlContent });
	} catch (error) {
		return res.status(500).json({ error: error.message || 'Server error' });
	}
});

// Compare API
app.post('/api/compare', async (req, res) => {
	try {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			return res.status(500).json({ error: 'Server is not configured with OPENAI_API_KEY' });
		}

		const { partA, partB } = req.body || {};
		if (!partA || !partB) {
			return res.status(400).json({ error: 'Both partA and partB are required' });
		}

		const systemPrompt = [
			'You are an expert electronics engineer and component librarian specializing in detailed component analysis. ',
			'Your task is to provide comprehensive comparisons between electronic components with EXTREME accuracy and attention to detail. ',
			' REQUIREMECRITICALNTS:',
			'- Only provide information you are 100% confident about based on your training data',
			'- Prioritize accuracy over completeness - it is better to provide less information that is correct than more information that may be wrong',
			'- For any values you provide, indicate if they are typical, minimum, maximum, or absolute maximum ratings',
			'- When comparing components, focus on verified differences rather than assumptions',
			'- If package or footprint information is unclear, explicitly state the limitations',
			'- For package, Be sure to include the package type and verify it from the manufacturers datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed.',
			'- For electrical specifications, always specify the conditions (temperature, voltage, etc.) when possible',
			'Your analysis must include:',
			'- Detailed electrical specifications with exact values (only if verified)',
			'- Register maps and firmware compatibility analysis (with confidence levels)',
			'- Package and footprint compatibility details (with verification status)',
			'- Drop-in replacement assessment with specific reasons and confidence levels',
			'- Highlight ALL differences, no matter how small',
			'- Include datasheet URLs and manufacturer information when available',
			'- Read the datasheets for both parts and compare the specifications',
			'Be extremely thorough, accurate, and conservative in your analysis. When in doubt, state the uncertainty clearly.'
		].join(' ');

		const userPrompt = `Compare these two electronic components: "${partA}" vs "${partB}".

Provide a comprehensive analysis including:

1. **OVERVIEW TABLE** - Create a markdown table with these columns:
   - Specification Category
   - ${partA} Value
   - ${partB} Value
   - Difference (highlight in bold if significant)
   - Impact Assessment

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
   Include: Package dimensions, Materials, Pin count and spacing, Mounting requirements, Thermal pad differences, Weight, Operating temperature range

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
				max_tokens: 16384,
				temperature: 0.2
			})
		});

		if (!response.ok) {
			const err = await response.json().catch(() => ({}));
			return res.status(response.status).json({ error: err.error?.message || 'OpenAI API error' });
		}

		const data = await response.json();
		const markdownContent = data?.choices?.[0]?.message?.content || '';
		if (!markdownContent) {
			return res.status(502).json({ error: 'Empty response from model' });
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

		return res.json({ html: safeHtml });
	} catch (error) {
		return res.status(500).json({ error: error.message || 'Server error' });
	}
});

// Start server
app.listen(PORT, 'https://candid-torrone-c16b89.netlify.app/', () => {
	console.log(`🚀 Part Alternative Finder server running on port ${PORT}`);
	console.log(`📱 Access from your company network:`);
	console.log(`   Local: http://localhost:${PORT}`);
	console.log(`   Network: http://https://candid-torrone-c16b89.netlify.app/${PORT}`);
	console.log(`   (Replace YOUR_VM_IP with your actual VM IP address)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('SIGTERM received, shutting down gracefully');
	process.exit(0);
});

process.on('SIGINT', () => {
	console.log('SIGINT received, shutting down gracefully');
	process.exit(0);
});
