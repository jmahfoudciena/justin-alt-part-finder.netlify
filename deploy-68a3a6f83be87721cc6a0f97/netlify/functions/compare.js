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

// Google Custom Search helper
async function googleSearch(partNumber) {
	const googleKey = process.env.GOOGLE_API_KEY;
	const googleCx = process.env.GOOGLE_CX;

	if (!googleKey || !googleCx) {
		throw new Error('Missing GOOGLE_API_KEY or GOOGLE_CX');
	}

	const query = `${partNumber} datasheet OR site:digikey.com OR site:mouser.com OR site:arrow.com OR site:avnet.com OR site:ti.com filetype:pdf`;
	const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&num=6&q=${encodeURIComponent(
		query
	)}`;

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

exports.handler = async (event, context) => {
	// CORS
	const headers = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS'
	};

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

		const { partA, partB } = JSON.parse(event.body || '{}');
		if (!partA || !partB) {
			return {
				statusCode: 400,
				headers,
				body: JSON.stringify({ error: 'Both partA and partB are required' })
			};
		}

		// 🔎 Google search for both parts
		let searchA = [];
		let searchB = [];
		try {
			searchA = await googleSearch(partA);
		} catch (err) {
			console.warn(`Google search failed for ${partA}:`, err.message);
		}
		try {
			searchB = await googleSearch(partB);
		} catch (err) {
			console.warn(`Google search failed for ${partB}:`, err.message);
		}

		// Format search results into markdown-like text
		const formatResults = (label, results) =>
			results.length
				? results
						.slice(0, 6)
						.map(
							(r, i) =>
								`${label} Result ${i + 1}: ${r.title}\nURL: ${r.link}\n${r.snippet}`
						)
						.join('\n\n')
				: `No search results found for ${label}.`;

		const searchSummaryA = formatResults(partA, searchA);
		const searchSummaryB = formatResults(partB, searchB);

		// System and user prompts
		const systemPrompt = `You are an expert electronics engineer and component librarian specializing in highly accurate component analysis and comparisons. Use only verified data from datasheets or distributor listings. If package or specs cannot be confirmed, explicitly state "Cannot be verified". Do not invent values.`;

		const userPrompt = `
Compare these two electronic components: **${partA}** vs **${partB}**.

Use the following web search results as context:

### ${partA} Search Results:
${searchSummaryA}

### ${partB} Search Results:
${searchSummaryB}

Perform a detailed comparison including:

1. Overview table (functions, applications, block diagram summary, notable use-case differences).  
2. Electrical specifications (voltage, current, power, frequency, thermal, memory if applicable).  
3. Register/firmware compatibility (register maps, programming differences, boot sequence, memory organization).  
4. Package & footprint (dimensions, pinouts, mismatches, mounting requirements). Include full pinout table with mismatches marked.  
5. Drop-in compatibility assessment (compatibility score, risks, required modifications).  
6. Recommendations (when to use each part, migration strategies, alternative suggestions).  

⚠️ **CRITICAL REQUIREMENTS**:  
- Only include verified specs (cite datasheet/distributor if possible).  
- Always specify conditions (min/max/typical/absolute max).  
- Highlight mismatches in bold.  
- State confidence levels.  
- If data cannot be verified from search context, say so explicitly.  
`;

		// Call OpenAI
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				],
				max_tokens: 8192,
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

		// Convert markdown → HTML
		const htmlContent = marked(markdownContent)
			.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
			.replace(/<table/g, '<table class="comparison-table"')
			.replace(/<tr/g, '<tr class="comparison-row"')
			.replace(/<td/g, '<td class="comparison-cell"')
			.replace(/<th/g, '<th class="comparison-header"');

		return {
			statusCode: 200,
			headers,
			body: JSON.stringify({
				html: htmlContent,
				raw: markdownContent,
				searchResults: { partA: searchA, partB: searchB }
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
