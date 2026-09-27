# voice-mcp (ElevenLabs版)

给Claude接语音的MCP服务器，使用ElevenLabs TTS。

## 部署步骤

### 1. 上传到GitHub
把这个文件夹里的所有文件上传到你的GitHub新仓库。

### 2. 部署到Railway
1. 去 [railway.app](https://railway.app)，用GitHub登录
2. 点 "New Project" → "Deploy from GitHub repo"
3. 选你刚上传的仓库
4. 点进项目，找到 "Variables"，添加三个环境变量：
   - `ELEVENLABS_API_KEY` = 你的API key
   - `VOICE_ID` = 你的声音ID
   - `BOT_NAME` = Claude（可以随便起名）
5. 等部署完成，复制生成的域名（格式类似 `xxx.railway.app`）

### 3. 接入Claude
1. Claude设置 → Connectors → Add Connector
2. 填入：`https://你的域名.railway.app/mcp`
3. 完成！

## 使用
接好后，对Claude说"帮我朗读这段话"，Claude就会调用speak工具播放语音。
