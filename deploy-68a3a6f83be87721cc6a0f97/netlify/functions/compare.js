// netlify/functions/compareParts.js
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  try {
    // Parse query params or JSON body
    let partA, partB;
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters;
      partA = params.partA;
      partB = params.partB;
    } else {
      const body = JSON.parse(event.body || "{}");
      partA = body.partA;
      partB = body.partB;
    }

    if (!partA || !partB) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing partA or partB" }),
      };
    }

    // GraphQL query for Nexar API (Octopart)
    const query = `
      query getParts($mpns: [String!]!) {
        supSearchMpn(q: { mpn_or_sku: $mpns }) {
          hits {
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
    `;

    const response = await fetch("https://api.nexar.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXAR_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        variables: { mpns: [partA, partB] },
      }),
    });

    const data = await response.json();
    if (!data || !data.data) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Invalid response from Nexar API", details: data }),
      };
    }

    const hits = data.data.supSearchMpn.hits;
    if (!hits || hits.length < 2) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "One or both parts not found" }),
      };
    }

    // Extract part data
    const partData = {};
    hits.forEach((hit) => {
      partData[hit.mpn] = {
        manufacturer: hit.manufacturer?.name || "Unknown",
        specs: hit.specs.map((s) => ({
          name: s.attribute?.name,
          value: s.display_value,
        })),
      };
    });

    // Convert specs into key-value maps
    const specsA = Object.fromEntries(
      partData[partA].specs.map((s) => [s.name, s.value])
    );
    const specsB = Object.fromEntries(
      partData[partB].specs.map((s) => [s.name, s.value])
    );

    // Find similarities and differences
    const similarities = [];
    const differences = [];

    const allKeys = new Set([...Object.keys(specsA), ...Object.keys(specsB)]);
    allKeys.forEach((key) => {
      const valA = specsA[key];
      const valB = specsB[key];
      if (valA && valB) {
        if (valA === valB) {
          similarities.push({ attribute: key, value: valA });
        } else {
          differences.push({ attribute: key, partA: valA, partB: valB });
        }
      } else {
        differences.push({ attribute: key, partA: valA || "N/A", partB: valB || "N/A" });
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        partA: partData[partA],
        partB: partData[partB],
        similarities,
        differences,
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
