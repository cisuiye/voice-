const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const app = express();
app.use(cors());
app.use(express.json());

const audioDir = path.join(__dirname, "audio");
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);
app.use("/audio", express.static(audioDir));

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;
const BOT_NAME = process.env.BOT_NAME || "AI";

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"] });
});
app.get("/oauth/authorize", (req, res) => {
  res.redirect(`${req.query.redirect_uri}?code=voice-mcp-code&state=${req.query.state}`);
});
app.post("/oauth/token", (req, res) => {
  res.json({ access_token: "voice-mcp-token", token_type: "bearer", expires_in: 86400 });
});

async function synthesizeSpeech(text) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!response.ok) throw new Error(`ElevenLabs API error: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

app.post("/mcp", async (req, res) => {
  try {
    const server = new McpServer({ name: "voice-mcp", version: "1.0.0" });
    
    server.tool(
      "speak",
      "将文字转换为语音并播放",
      { text: z.string().describe("要朗读的文字") },
      async ({ text }) => {
        try {
          const base64Audio = await synthesizeSpeech(text);
          const fileName = `${crypto.randomUUID()}.mp3`;
          fs.writeFileSync(path.join(audioDir, fileName), Buffer.from(base64Audio, "base64"));
          const audioUrl = `${req.protocol}://${req.get("host")}/audio/${fileName}`;

          // 🎨 这是我们要塞给 Claude 的 HTML 音频标签，如果它支持渲染，就会出现播放器
          const htmlPlayer = `<audio controls src="${audioUrl}" style="width: 100%; border-radius: 12px;"></audio>`;
          
          return { 
            content: [
              // 1. 尝试返回 HTML 播放器
              { type: "text", text: htmlPlayer },
              // 2. 保底提示
              { type: "text", text: "🔊 如果上方没有出现播放器，请点击下方链接播放：\n" + audioUrl }
            ] 
          };
        } catch (err) {
          return { content: [{ type: "text", text: `语音合成失败: ${err.message}` }], isError: true };
        }
      }
    );

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/mcp", (req, res) => res.status(405).json({ error: "Method Not Allowed" }));
app.get("/status", (req, res) => res.json({ status: "ok", bot: BOT_NAME }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
