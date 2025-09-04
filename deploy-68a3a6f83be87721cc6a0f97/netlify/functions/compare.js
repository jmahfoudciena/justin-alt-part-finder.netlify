const fetch = require("node-fetch");

// --- Get Nexar OAuth2 access token ---
async function getNexarToken() {
  const res = await fetch("https://identity.nexar.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXAR_CLIENT_ID,
      client_secret: process.env.NEXAR_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "supply.domain"
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Failed to get Nexar access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

// --- Fetch a single part from Nexar ---
async function fetchPart(mpn, token) {
  const query = `
    query getPart($mpn: String!) {
      supSearchMpn(q: $mpn, limit: 1) {
        results {
          part {
            mpn
            manufacturer { name }
            specs {
              attribute { name id shortname }
              displayValue
            }
          }
        }
      }
    }`;

  const res = await fetch("https://api.nexar.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables: { mpn } }),
  });

  const data = await res.json();
  console.log(`Nexar response for ${mpn}:`, JSON.stringify(data, null, 2));

  if (data.errors) {
    console.error(`GraphQL errors for ${mpn}:`, data.errors);
    return null;
  }

  const results = data?.data?.supSearchMpn?.results;
  if (!results || results.length === 0) return null;

  return results[0]?.part || null;
}

// --- Generate comparison table via GPT-4o ---
async function getComparisonTable(partA, partB) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful assistant that compares electronic components." },
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

    const data = await res.json();
    console.log("OpenAI response:", JSON.stringify(data, null, 2));
    return data.choices?.[0]?.message?.content || "No table generated.";
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return "Error generating comparison table";
  }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  try {
    const { partA: partANum, partB: partBNum } =
      event.httpMethod === "GET"
        ? event.queryStringParameters
        : JSON.parse(event.body || "{}");

    if (!partANum || !partBNum) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing partA or partB" }) };
    }

    const token = await getNexarToken();

    // Fetch each part individually
    const partA = await fetchPart(partANum, token);
    const partB = await fetchPart(partBNum, token);

    if (!partA && !partB) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Neither part found" }) };
    }

    if (!partA || !partB) {
      return {
        statusCode: 206, // Partial content
        headers,
        body: JSON.stringify({ error: "Only one part found", partA, partB }),
      };
    }

    // Generate comparison table via GPT-4o
    const comparisonTable = await getComparisonTable(partA, partB);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ partA, partB, comparisonTable }),
    };
  } catch (err) {
    console.error("Full error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error", details: err.message }) };
  }
};
