const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const twilio = require('twilio');
const { MessagingResponse } = twilio.twiml;

const app = express();
const PORT = process.env.PORT || 3001;

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

// Media serving endpoint for Twilio
app.get('/api/media', async (req, res) => {
  const { url: websiteUrl, format } = req.query;
  const ytdlpPath = path.join(__dirname, 'bin', 'yt-dlp');
  
  const args = [
    '--ffmpeg-location', ffmpegPath,
    '-o', '-', 
    '--no-playlist',
    '--no-warnings'
  ];

  if (format === 'mp3') {
    args.push('-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3');
    res.set('Content-Type', 'audio/mpeg');
  } else {
    // 480p is a good compromise for WhatsApp 16MB limit
    args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]', '--merge-output-format', 'mp4');
    res.set('Content-Type', 'video/mp4');
  }

  args.push(websiteUrl);

  const ytdlp = spawn(ytdlpPath, args);
  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on('data', (data) => {
    console.error(`yt-dlp stderr: ${data}`);
  });

  req.on('close', () => {
    ytdlp.kill();
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
