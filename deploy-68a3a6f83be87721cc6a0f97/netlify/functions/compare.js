const { marked } = require('marked');

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false,
});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Server is not configured with OPENAI_API_KEY');

    const { partA, partB } = JSON.parse(event.body || '{}');
    if (!partA || !partB) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both partA and partB are required' }) };
    }

    // Keep your full detailed system prompt
    const systemPrompt = `
You are an expert electronics engineer and component librarian specializing in detailed component analysis.
Your task is to provide comprehensive comparisons between electronic components with EXTREME accuracy and attention to detail.
REQUIREMECRITICALNTS:
- Only provide information you are 100% confident about based on your training data
- Prioritize accuracy over completeness - it is better to provide less information that is correct than more information that may be wrong
- For any values you provide, indicate if they are typical, minimum, maximum, or absolute maximum ratings
- When comparing components, focus on verified differences rather than assumptions
- If package or footprint information is unclear, explicitly state the limitations. Do not assume or invent package type
- For package, Be sure to include the package type and verify it from the manufacturers datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed. Confirm using: Official datasheet (Features, Description, Ordering Information) Distributor listings (e.g., Digi-Key, Mouser)
- For electrical specifications, always specify the conditions (temperature, voltage, etc.) when possible
Your analysis must include:
- Detailed electrical specifications with exact values (only if verified)
- Register maps and firmware compatibility analysis (with confidence levels)
- Package and footprint compatibility details (with verification status)
- Drop-in replacement assessment with specific reasons and confidence levels
- Highlight ALL differences, no matter how small
- Include datasheet URLs and manufacturer information when available
- Read the datasheets for both parts and compare the specifications
Be extremely thorough, accurate, and conservative in your analysis. When in doubt, state the uncertainty clearly.
`;

    // Split user prompt into sections
    const sections = [
      `OVERVIEW TABLE for "${partA}" vs "${partB}"`,
      `ELECTRICAL SPECIFICATIONS for "${partA}" vs "${partB}"`,
      `REGISTER/FIRMWARE COMPATIBILITY for "${partA}" vs "${partB}"`,
      `PACKAGE & FOOTPRINT for "${partA}" vs "${partB}"`,
      `DROP-IN COMPATIBILITY ASSESSMENT for "${partA}" vs "${partB}"`,
      `RECOMMENDATIONS for "${partA}" vs "${partB}"`,
    ];

    let combinedMarkdown = '';

    for (const section of sections) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: section },
          ],
          max_completion_tokens: 1500, // safe per-section limit
          reasoning_effort: 'high',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { statusCode: response.status, headers, body: JSON.stringify({ error: err.error?.message || 'OpenAI API error' }) };
      }

      const data = await response.json();
      const markdownContent = data?.choices?.[0]?.message?.content || '';
      combinedMarkdown += '\n\n' + markdownContent;
    }

    const htmlContent = marked(combinedMarkdown)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<table/g, '<table class="comparison-table"')
      .replace(/<tr/g, '<tr class="comparison-row"')
      .replace(/<td/g, '<td class="comparison-cell"')
      .replace(/<th/g, '<th class="comparison-header"');

    return { statusCode: 200, headers, body: JSON.stringify({ html: htmlContent }) };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Server error' }) };
  }
};
