const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");

const app = express();
app.use(express.json());

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;
const BOT_NAME = process.env.BOT_NAME || "AI";

// OAuth endpoints required by Claude.ai
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  const code = "voice-mcp-code";
  res.redirect(`${redirect_uri}?code=${code}&state=${state}`);
});

app.post("/oauth/token", (req, res) => {
  res.json({
    access_token: "voice-mcp-token",
    token_type: "bearer",
    expires_in: 86400,
  });
});

async function synthesizeSpeech(text) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs API error: ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");
  return base64Audio;
}

function buildAudioPlayerHtml(base64Audio, text) {
  return `<audio controls style="width:100%;border-radius:12px;">
<source src="data:audio/mpeg;base64,${base64Audio}" type="audio/mpeg">
</audio>
<p style="font-size:13px;color:#888;margin-top:6px;">${text}</p>`;
}

const transports = {};

app.get("/mcp", async (req, res) => {
  const server = new McpServer({
    name: "voice-mcp",
    version: "1.0.0",
  });

  server.tool(
    "speak",
    "将文字转换为语音并播放",
    { text: z.string().describe("要朗读的文字") },
    async ({ text }) => {
      try {
        const base64Audio = await synthesizeSpeech(text);
        const html = buildAudioPlayerHtml(base64Audio, text);
        return {
          content: [{ type: "text", text: html }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `语音合成失败: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  const transport = new SSEServerTransport("/mcp", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

app.post("/mcp", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get("/status", (req, res) => {
  res.json({ status: "ok", bot: BOT_NAME });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice MCP server running on port ${PORT}`);
});


  
