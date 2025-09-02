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
	// Background functions respond immediately with 202
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

	// Immediately respond with 202 Accepted
	setTimeout(async () => {
		try {
			const apiKey = process.env.OPENAI_API_KEY;
			if (!apiKey) throw new Error('Server is not configured with OPENAI_API_KEY');

			const { partNumber } = JSON.parse(event.body || '{}');
			if (!partNumber) throw new Error('Part number is required');

			const prompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}...`; // truncated for brevity

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
							content: 'You are a helpful electronics engineer who specializes in finding component alternatives...'
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
			const markdownContent = data.choices[0].message.content;
			const htmlContent = marked(markdownContent);

			console.log('Background function result:', htmlContent); // log result for debugging / monitoring
		} catch (error) {
			console.error('Background function error:', error.message || error);
		}
	}, 0);

	// Return immediately
	return {
		statusCode: 202,
		headers,
		body: JSON.stringify({ message: 'Request accepted and processing in background.' })
	};
};
