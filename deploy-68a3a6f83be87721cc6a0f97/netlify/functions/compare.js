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
      scope: "sup.read"
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Failed to get Nexar access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  try {
    // Get input
    const { partA, partB } =
      event.httpMethod === "GET"
        ? event.queryStringParameters
        : JSON.parse(event.body || "{}");

    if (!partA || !partB) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing partA or partB" }),
      };
    }

    // Get token
    const token = await getNexarToken();

    // GraphQL query
    const query = `
      query getParts($mpns: [String!]!) {
        supSearch(q: { mpn_or_sku: $mpns }) {
          results {
            part {
              mpn
              manufacturer {
                name
              }
              specs {
                attribute {
                  name
                }
                display_value
              }
            }
          }
        }
      }
    `;

    // Call Nexar
    const res = await fetch("https://api.nexar.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables: { mpns: [partA, partB] } }),
    });

    const data = await res.json();

    const parts = data?.data?.supSearch?.results?.map((r) => r.part) || [];
    if (parts.length < 2) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: "One or both parts not found",
          response: data,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ parts }),
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
