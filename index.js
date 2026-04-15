const express = require('express');
const cors = require('cors');
const { Innertube, UniversalCache } = require('youtubei.js');
const { Readable } = require('stream');
const twilio = require('twilio');
const { MessagingResponse } = twilio.twiml;

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Singleton for YouTube Session
let ytSession = null;
async function getYTSession() {
  if (ytSession) return ytSession;
  ytSession = await Innertube.create({
    cache: new UniversalCache(false),
    generate_session_store: true,
    client_type: 'TV'
  });
  return ytSession;
}

// Extract Video ID from various YouTube URL formats
function getYouTubeID(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Twilio WhatsApp Webhook
app.post('/api/whatsapp/webhook', async (req, res) => {
  const incomingMsg = req.body.Body || '';
  const twiml = new MessagingResponse();

  // Extract URL
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = incomingMsg.match(urlRegex);
  const websiteUrl = urls ? urls[0] : null;
  const videoId = websiteUrl ? getYouTubeID(websiteUrl) : null;

  // Extract Format
  const isMp4 = incomingMsg.toLowerCase().includes('mp4');
  const format = isMp4 ? 'mp4' : 'mp3'; // default to mp3

  if (!videoId) {
    twiml.message('Veuillez envoyer un lien YouTube valide avec le format souhaité (ex: mp3 ou mp4).');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  try {
    const yt = await getYTSession();
    const info = await yt.getBasicInfo(videoId);
    const durationSeconds = info.basic_info.duration;

    // Approximate limits to not exceed 16MB on WhatsApp
    const maxDuration = format === 'mp3' ? 900 : 180;

    if (durationSeconds > maxDuration) {
      twiml.message('Désolé, la vidéo est trop longue pour être envoyée sur WhatsApp.');
      res.type('text/xml').send(twiml.toString());
      return;
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    
    // Construct local stream URL for Twilio to fetch
    const mediaUrl = `${protocol}://${host}/api/media?videoId=${videoId}&format=${format}`;

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
  const { videoId, format } = req.query;

  if (!videoId) {
    return res.status(400).send('Invalid URL');
  }

  try {
    const yt = await getYTSession();
    const info = await yt.getBasicInfo(videoId);
    const title = info.basic_info.title.replace(/[^a-zA-Z0-9 ]/g, ''); // sanitize filename

    if (format === 'mp3') {
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Disposition', `attachment; filename="${title}.mp3"`);
      const stream = await yt.download(videoId, { type: 'audio', quality: 'best' });
      Readable.fromWeb(stream).pipe(res);
    } else {
      res.set('Content-Type', 'video/mp4');
      res.set('Content-Disposition', `attachment; filename="${title}.mp4"`);
      const stream = await yt.download(videoId, { type: 'video_or_audio', quality: 'best', format: 'mp4' });
      Readable.fromWeb(stream).pipe(res);
    }
  } catch (error) {
    console.error('Direct media fetch error:', error);
    res.status(500).send('Error streaming media');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
