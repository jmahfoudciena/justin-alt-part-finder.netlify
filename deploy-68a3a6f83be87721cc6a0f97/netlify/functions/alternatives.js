const fetch = require("node-fetch");
const { marked } = require("marked");

marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: true,
  mangle: false,
});

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };

  try {
    const { partNumber } = JSON.parse(event.body || "{}");
    if (!partNumber)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Part number is required" }),
      };

    // --- STEP 1: Get Digi-Key Access Token ---
    const tokenResp = await fetch("https://api.digikey.com/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DIGIKEY_CLIENT_ID,
        client_secret: process.env.DIGIKEY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });

    if (!tokenResp.ok) {
      throw new Error(`Digi-Key auth failed: ${tokenResp.statusText}`);
    }
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;

    // --- STEP 2: Lookup Part Details ---
    const lookupUrl = `https://api.digikey.com/Search/v3/Products/${encodeURIComponent(
      partNumber
    )}`;
    const partResp = await fetch(lookupUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!partResp.ok) {
      throw new Error(`Digi-Key part lookup failed: ${partResp.statusText}`);
    }

    const partData = await partResp.json();
    const product = partData?.Product || partData;

    if (!product) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Part not found on Digi-Key" }),
      };
    }

    // Extract Package / Case info
    const packageAttr =
      product.Parameters?.find(
        (p) =>
          p.ParameterName === "Package / Case" ||
          p.ParameterName === "Supplier Device Package"
      )?.Value || "Unknown";

    // --- STEP 3: Build GPT Prompt ---
    const prompt = `
Find 3 alternative electronic components for part number: ${partNumber}.

Original package type: ${packageAttr}

Rules:
1. Alternatives must have the same package type if possible.
2. Prioritize functional equivalents from reputable manufacturers.
3. Verify lifecycle status (Active, NRND, Last Time Buy).
4. Provide Digi-Key or Mouser price if available.
5. Return results in clear numbered sections with:
   - Part Number
   - Description
   - Manufacturer
   - Package Type (verified)
   - Price & Distributor link
   - Key differences vs original
`;

    // --- STEP 4: Ask OpenAI ---
    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful electronics engineer who finds Digi-Key part alternatives.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
      }),
    });

    if (!aiResp.ok) {
      const errorData = await aiResp.json();
      throw new Error(
        `OpenAI API Error: ${errorData.error?.message || aiResp.statusText}`
      );
    }

    const aiData = await aiResp.json();
    const markdownContent = aiData.choices?.[0]?.message?.content || "";
    const htmlContent = marked(markdownContent);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        package: packageAttr,
        alternatives: htmlContent,
        raw: markdownContent,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Server error" }),
    };
  }
};
