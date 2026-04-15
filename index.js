const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const twilio = require('twilio');
const { MessagingResponse } = twilio.twiml;

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Twilio WhatsApp Webhook
app.post('/api/whatsapp/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const twiml = new MessagingResponse();
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = incomingMsg.match(urlRegex);
  const websiteUrl = urls ? urls[0] : null;
  const format = incomingMsg.toLowerCase().includes('mp4') ? 'mp4' : 'mp3';

  if (!websiteUrl) {
    twiml.message('Veuillez envoyer un lien YouTube valide.');
    return res.type('text/xml').send(twiml.toString());
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const encodedUrl = encodeURIComponent(websiteUrl);
  const mediaUrl = `${protocol}://${host}/api/media?url=${encodedUrl}&format=${format}`;

  const msg = twiml.message('Voici votre fichier !');
  msg.media(mediaUrl);

  res.type('text/xml').send(twiml.toString());
});

// Media serving endpoint for Twilio (Fixed 0-byte issue with temp files)
app.get('/api/media', async (req, res) => {
  const { url: websiteUrl, format } = req.query;
  const ytdlpPath = path.join(__dirname, 'bin', 'yt-dlp');
  const tempFileId = `tw_${Date.now()}`;
  const tempFilePath = path.join(tempDir, tempFileId);
  
  const args = [
    '--ffmpeg-location', ffmpegPath,
    '-o', tempFilePath, 
    '--no-playlist',
    '--no-warnings'
  ];

  if (format === 'mp3') {
    // Force MP3 extraction
    args.push('-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3');
  } else {
    // 480p is a good compromise for WhatsApp 16MB limit
    args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]', '--merge-output-format', 'mp4');
  }

  args.push(websiteUrl);

  const ytdlp = spawn(ytdlpPath, args);

  ytdlp.on('close', (code) => {
    const finalExt = format === 'mp3' ? '.mp3' : '.mp4';
    const filePath = tempFilePath + finalExt;

    if (fs.existsSync(filePath)) {
      res.sendFile(filePath, (err) => {
        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      });
    } else {
      console.error(`Media creation failed with code ${code}`);
      res.status(500).send('Processing failed');
    }
  });

  ytdlp.stderr.on('data', (data) => console.error(`yt-dlp: ${data}`));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
