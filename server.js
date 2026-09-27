const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");

const app = express();
app.use(express.json());

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;
const BOT_NAME = process.env.BOT_NAME || "AI";

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

function buildAudioPlayerHtml(base64Audio, text, botName) {
  return `<audio-player>
<audio src="data:audio/mpeg;base64,${base64Audio}" controls style="width:100%;border-radius:12px;"></audio>
<details style="margin-top:8px;font-size:13px;color:#888;">
<summary>查看文本</summary>
<p style="margin:6px 0 0 0;">${text}</p>
</details>
</audio-player>`;
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
        const html = buildAudioPlayerHtml(base64Audio, text, BOT_NAME);
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
