const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
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

  // Extract URL
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = incomingMsg.match(urlRegex);
  const websiteUrl = urls ? urls[0] : null;

  // Extract Format
  const isMp4 = incomingMsg.toLowerCase().includes('mp4');
  const format = isMp4 ? 'mp4' : 'mp3'; // default to mp3

  if (!websiteUrl || !ytdl.validateURL(websiteUrl)) {
    twiml.message('Veuillez envoyer un lien YouTube valide avec le format souhaité (ex: mp3 ou mp4).');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  try {
    const info = await ytdl.getInfo(websiteUrl);
    const durationSeconds = parseInt(info.videoDetails.lengthSeconds, 10);

    // Approximate limits to not exceed 16MB on WhatsApp
    // MP3 normally ~1MB per minute (max ~15 min)
    // MP4 normally ~5MB per minute at 360p (max ~3 min)
    const maxDuration = format === 'mp3' ? 900 : 180;

    if (durationSeconds > maxDuration) {
      twiml.message('Désolé, la vidéo est trop longue pour être envoyée sur WhatsApp.');
      res.type('text/xml').send(twiml.toString());
      return;
    }

    // Determine the public host dynamically from the request headers
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const encodedUrl = encodeURIComponent(websiteUrl);
    
    // Construct local stream URL for Twilio to fetch
    const mediaUrl = `${protocol}://${host}/api/media?url=${encodedUrl}&format=${format}`;

    const msg = twiml.message('Voici votre fichier !');
    msg.media(mediaUrl);

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('Twilio webhook error:', error);
    twiml.message('Une erreur est survenue lors du traitement de la vidéo.');
    res.type('text/xml').send(twiml.toString());
  }
});

// Media serving endpoint for Twilio
app.get('/api/media', async (req, res) => {
  const { url: websiteUrl, format } = req.query;

  if (!websiteUrl || !ytdl.validateURL(websiteUrl)) {
    return res.status(400).send('Invalid URL');
  }

  try {
    const info = await ytdl.getInfo(websiteUrl);
    const title = info.videoDetails.title.replace(/[^a-zA-Z0-9 ]/g, ''); // sanitize filename

    if (format === 'mp3') {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Disposition', `attachment; filename="${title}.mp3"`);
      console.log(`Streaming MP3 to Twilio for ${websiteUrl}`);
      ytdl(websiteUrl, { quality: 'highestaudio' }).pipe(res);
    } else {
      res.set('Content-Type', 'video/mp4');
      res.set('Content-Disposition', `attachment; filename="${title}.mp4"`);
      console.log(`Streaming MP4 to Twilio for ${websiteUrl}`);
      ytdl(websiteUrl, { quality: 'highestvideo' }).pipe(res);
    }
  } catch (error) {
    console.error('Direct media fetch error:', error);
    res.status(500).send('Error streaming media');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
