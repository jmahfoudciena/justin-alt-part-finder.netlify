const { marked } = require("marked");

marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false,
});

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Server missing OPENAI_API_KEY" }) };

    const { partA, partB } = JSON.parse(event.body || "{}");
    if (!partA || !partB)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Both partA and partB are required" }) };

    // Define the sections
    const sections = [
      { name: "Overview Table", prompt: `Create a markdown overview table comparing ${partA} vs ${partB}` },
      { name: "Electrical Specifications", prompt: `Create a markdown table of electrical specs for ${partA} vs ${partB}` },
      { name: "Register/Firmware Compatibility", prompt: `Create a table comparing register maps and firmware compatibility for ${partA} vs ${partB}` },
      { name: "Package & Footprint", prompt: `Compare package and footprint for ${partA} vs ${partB}, include verified pinout` },
      { name: "Drop-in Compatibility Assessment", prompt: `Assess drop-in compatibility for ${partA} vs ${partB}` },
      { name: "Recommendations", prompt: `Provide recommendations, migration strategies, and alternatives for ${partA} vs ${partB}` },
    ];

    let fullMarkdown = "";

    // Fetch GPT-5 for each section separately
    for (const section of sections) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5",
          messages: [
            { role: "system", content: "You are an expert electronics engineer. Provide factual, verified, deterministic comparisons." },
            { role: "user", content: section.prompt },
          ],
          max_completion_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { statusCode: response.status, headers, body: JSON.stringify({ error: err.error?.message || "OpenAI API error" }) };
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) continue;
      fullMarkdown += `\n\n## ${section.name}\n${content}`;
    }

    const htmlContent = marked(fullMarkdown)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<table/g, '<table class="comparison-table"')
      .replace(/<tr/g, '<tr class="comparison-row"')
      .replace(/<td/g, '<td class="comparison-cell"')
      .replace(/<th/g, '<th class="comparison-header"');

    return { statusCode: 200, headers, body: JSON.stringify({ html: htmlContent }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || "Server error" }) };
  }
};
