const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { registerAppResource, registerAppTool } = require("@modelcontextprotocol/ext-apps");
const { z } = require("zod");

const app = express();
app.use(cors());
app.use(express.json());

// 静态文件服务，用于存储音频
const audioDir = path.join(__dirname, "audio");
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);
app.use("/audio", express.static(audioDir));

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;
const BOT_NAME = process.env.BOT_NAME || "AI";

// OAuth 占位
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

// 生成语音
async function synthesizeSpeech(text) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!response.ok) throw new Error(`ElevenLabs API error: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

// 🎨 这是要在 Claude App 里直接渲染的播放器 UI（HTML/CSS/JS）
const PLAYER_UI = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 16px; background: #ffffff; color: #1a1a1a; display: flex; justify-content: center; }
  .player-card { width: 100%; max-width: 380px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 12px; }
  .player-main { display: flex; align-items: center; gap: 12px; }
  .play-btn { width: 48px; height: 48px; border-radius: 50%; background: #000; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; transition: transform 0.2s; flex-shrink: 0; }
  .play-btn:active { transform: scale(0.95); }
  .waveform { flex-grow: 1; height: 24px; display: flex; align-items: center; gap: 3px; overflow: hidden; }
  .waveform span { width: 3px; background: #ccc; border-radius: 2px; animation: wave 1s ease-in-out infinite alternate; }
  .waveform span:nth-child(odd) { height: 10px; animation-delay: 0.2s; }
  .waveform span:nth-child(even) { height: 20px; animation-delay: 0.4s; }
  @keyframes wave { 0% { transform: scaleY(0.5); } 100% { transform: scaleY(1.5); } }
  .time { font-size: 13px; color: #888; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .transcript-toggle { font-size: 13px; color: #10a37f; cursor: pointer; text-decoration: underline; user-select: none; }
  .transcript { display: none; font-size: 14px; color: #444; background: #fff; padding: 12px; border-radius: 8px; border: 1px solid #eee; line-height: 1.5; }
  audio { display: none; }
</style>
</head>
<body>
  <div class="player-card">
    <div class="player-main">
      <button class="play-btn" id="playBtn">▶</button>
      <div class="waveform" id="waveform"></div>
      <div class="time" id="time">0:00</div>
    </div>
    <div class="transcript-toggle" id="toggleBtn">▶ Show transcript</div>
    <div class="transcript" id="transcript"></div>
    <audio id="audioEl"></audio>
  </div>
<script>
  // 生成波形
  const wf = document.getElementById('waveform');
  for(let i=0; i<28; i++) { const span = document.createElement('span'); wf.appendChild(span); }

  const audio = document.getElementById('audioEl');
  const playBtn = document.getElementById('playBtn');
  const timeEl = document.getElementById('time');
  const transcriptEl = document.getElementById('transcript');
  const toggleBtn = document.getElementById('toggleBtn');

  // 从 Claude 传递的数据中获取音频和文字
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data.type === 'tool_result' || data.audioUrl) {
        audio.src = data.audioUrl || data._meta?.audioUrl;
        transcriptEl.textContent = data.text || '';
    }
  });

  // 也可以尝试自动获取 (视 ext-apps 版本而定)
  setTimeout(() => {
     // 如果 Claude 注入了数据，这里可以处理
  }, 100);

  playBtn.addEventListener('click', () => {
    if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; } 
    else { audio.pause(); playBtn.textContent = '▶'; }
  });

  audio.addEventListener('timeupdate', () => {
    const mins = Math.floor(audio.currentTime / 60);
    const secs = Math.floor(audio.currentTime % 60);
    timeEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
    const progress = audio.currentTime / audio.duration;
    // 简单控制波形高亮
    const bars = wf.querySelectorAll('span');
    bars.forEach((bar, i) => {
       if (i / bars.length <= progress) bar.style.background = '#000';
       else bar.style.background = '#ccc';
    });
  });

  audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });

  toggleBtn.addEventListener('click', () => {
    if (transcriptEl.style.display === 'block') {
      transcriptEl.style.display = 'none'; toggleBtn.textContent = '▶ Show transcript';
    } else {
      transcriptEl.style.display = 'block'; toggleBtn.textContent = '▼ Hide transcript';
    }
  });
</script>
</body>
</html>
`;

// MCP 服务
app.post("/mcp", async (req, res) => {
  try {
    const server = new McpServer({ name: "voice-mcp", version: "1.0.0" });

    // 1. 注册界面资源
    registerAppResource(
      server,
      "Voice Player",
      "ui://voice/player.html",
      { description: "Inline audio player" },
      async () => ({
        contents: [{ uri: "ui://voice/player.html", mimeType: "text/html;profile=mcp-app", text: PLAYER_UI }],
      })
    );

    // 2. 注册工具，并绑定界面
    registerAppTool(
      server,
      "speak",
      "将文字转换为语音并播放",
      { text: z.string().describe("要朗读的文字") },
      async ({ text }) => {
        try {
          const base64Audio = await synthesizeSpeech(text);
          const fileName = `${crypto.randomUUID()}.mp3`;
          fs.writeFileSync(path.join(audioDir, fileName), Buffer.from(base64Audio, "base64"));
          const audioUrl = `${req.protocol}://${req.get("host")}/audio/${fileName}`;

          // 注意：_meta 里包含音频 url 和原始文字，供上面的 HTML 使用
          return {
            content: [{ type: "text", text: `语音已生成：${text}` }],
            _meta: {
              ui: { resourceUri: "ui://voice/player.html" },
              audioUrl: audioUrl,
              text: text
            },
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
