const fetch = require("node-fetch");

// Helper: Get Nexar OAuth2 access token
async function getNexarToken() {
  const res = await fetch("https://identity.nexar.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXAR_CLIENT_ID,
      client_secret: process.env.NEXAR_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "supply"
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Failed to get Nexar access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

// Helper: Call OpenAI
async function getComparisonTable(partA, partB) {
  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o", // or "gpt-4o-mini"
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that compares electronic components."
        },
        {
          role: "user",
          content: `Compare the following two parts and produce a Markdown table highlighting similarities and differences.

Part A (${partA.mpn}, ${partA.manufacturer.name}):
${JSON.stringify(partA.specs, null, 2)}

Part B (${partB.mpn}, ${partB.manufacturer.name}):
${JSON.stringify(partB.specs, null, 2)}`
        }
      ],
      temperature: 0.2
    }),
  });

  const data = await openaiRes.json();
  return data.choices?.[0]?.message?.content || "No table generated.";
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  try {
    // Get input
    const { partA: partANum, partB: partBNum } =
      event.httpMethod === "GET"
        ? event.queryStringParameters
        : JSON.parse(event.body || "{}");

    if (!partANum || !partBNum) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing partA or partB" }),
      };
    }

    // Nexar token
    const token = await getNexarToken();

    // GraphQL query
    const query = `
      query getParts($mpns: [String!]!) {
        supSearch(q: { mpn_or_sku: $mpns }) {
          results {
            part {
              mpn
              manufacturer { name }
              specs {
                attribute { name }
                display_value
              }
            }
          }
        }
      }
    `;

    // Fetch parts from Nexar
    const res = await fetch("https://api.nexar.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables: { mpns: [partANum, partBNum] } }),
    });
    const data = await res.json();

    const parts = data?.data?.supSearch?.results?.map((r) => r.part);
    if (!parts || parts.length < 2) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "One or both parts not found", response: data }),
      };
    }

    const partA = parts[0];
    const partB = parts[1];

    // OpenAI comparison
    const comparisonTable = await getComparisonTable(partA, partB);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        partA,
        partB,
        comparisonTable
      }),
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error", details: err.message }),
    };
  }
};
