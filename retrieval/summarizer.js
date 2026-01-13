const axios = require("axios");

const DEFAULT_MAX_SNIPPET_CHARS = 800;

function normalizeBaseUrl(value) {
  if (!value) {
    return "https://openrouter.ai/api/v1";
  }
  return String(value).trim().replace(/\/+$/, "");
}

function buildExcerpt(text, maxChars = DEFAULT_MAX_SNIPPET_CHARS) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxChars)}...`;
}

function hasOpenRouterConfig() {
  return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL);
}

function buildContext(chunks, sourcesList) {
  const blocks = chunks.map((chunk, index) => {
    const source = sourcesList[index] || `${index + 1}) Unknown`;
    const excerpt = buildExcerpt(chunk.text);
    return `[${index + 1}] ${source}\n${excerpt}`;
  });

  return `Sources:\n${blocks.join("\n\n")}`;
}

async function summarizeWithOpenRouter(question, chunks, sourcesList) {
  if (!hasOpenRouterConfig()) {
    return "";
  }

  const baseUrl = normalizeBaseUrl(process.env.OPENROUTER_API_BASE_URL);
  const model = process.env.OPENROUTER_MODEL;
  const appUrl = process.env.OPENROUTER_APP_URL || undefined;
  const appTitle = process.env.OPENROUTER_APP_TITLE || undefined;
  const botName = process.env.BOT_NAME || "SeaTalk Bot";

  const systemPrompt =
    `You are ${botName}. Answer using the provided sources only. ` +
    "If the answer is not in the sources, say you do not know. " +
    "Include citations in the form [1], [2] that match the Sources list.";
  const context = buildContext(chunks, sourcesList);

  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Question: ${question}\n\n${context}`
          }
        ],
        temperature: 0.2,
        max_tokens: 220
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": appUrl,
          "X-Title": appTitle,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content?.trim();
    return reply || "";
  } catch (error) {
    console.error(
      "OpenRouter summary failed:",
      error.response?.data || error.message
    );
    return "";
  }
}

module.exports = {
  summarizeWithOpenRouter
};
