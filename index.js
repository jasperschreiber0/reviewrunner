require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const BASE_URL = process.env.BASE_URL;

// POST /review-request
// Called by kaspr-agent1 2 hours after booking is marked complete
app.post('/review-request', async (req, res) => {
  const { client_id, booking_id } = req.body;

  if (!client_id || !booking_id) {
    return res.status(400).json({ error: 'client_id and booking_id required' });
  }

  try {
    const { data: client, error } = await supabase
      .from('clients')
      .select('id, first_name, phone, business_id, opted_out, reviewed_at, businesses(name, google_review_url)')
      .eq('id', client_id)
      .single();

    if (error || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.opted_out) {
      return res.status(200).json({ status: 'skipped', reason: 'opted_out' });
    }

    const businessName = client.businesses?.name || 'your salon';
    let message;
    let messageType;

    if (client.reviewed_at) {
      // Already reviewed — send warm thank you instead
      message = `Hi ${client.first_name}, thanks so much for coming into ${businessName} today — we loved having you. See you next time! 😊`;
      messageType = 'thankyou';
    } else {
      // Not yet reviewed — send review request with tracking link
      const trackingUrl = `${BASE_URL}/r/${client_id}`;
      message = `Hi ${client.first_name}, thanks for visiting ${businessName}! We'd love to hear how your experience was — it only takes 30 seconds. Leave us a quick review here: ${trackingUrl} 🙏`;
      messageType = 'review_request';
    }

    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${client.phone}`,
      body: message
    });

    // Log the send
    await supabase.from('reviewrunner_log').insert({
      client_id: client.id,
      business_id: client.business_id,
      booking_id,
      message_type: messageType,
      message_sent: message,
      sent_at: new Date().toISOString()
    });

    return res.status(200).json({ status: 'sent', message_type: messageType, client_id });

  } catch (err) {
    console.error('ReviewRunner error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /r/:client_id — tracking link
// Marks client as reviewed and redirects to Google review page
app.get('/r/:client_id', async (req, res) => {
  const { client_id } = req.params;

  try {
    const { data: client, error } = await supabase
      .from('clients')
      .select('id, business_id, reviewed_at, businesses(google_review_url)')
      .eq('id', client_id)
      .single();

    if (error || !client) {
      return res.redirect('https://google.com');
    }

    // Mark as reviewed if not already
    if (!client.reviewed_at) {
      await supabase.from('clients').update({
        reviewed_at: new Date().toISOString()
      }).eq('id', client_id);

      await supabase.from('reviewrunner_log').insert({
        client_id: client.id,
        business_id: client.business_id,
        message_type: 'review_click',
        sent_at: new Date().toISOString()
      });
    }

    const googleUrl = client.businesses?.google_review_url || 'https://google.com';
    return res.redirect(googleUrl);

  } catch (err) {
    console.error('Tracking link error:', err);
    return res.redirect('https://google.com');
  }
});

// POST /webhook/twilio — handles STOP replies
app.post('/webhook/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '');
  const body = req.body.Body?.trim().toUpperCase();

  if (!from) return res.sendStatus(400);

  if (body === 'STOP') {
    await supabase.from('clients').update({ opted_out: true }).eq('phone', from);
    console.log(`Opt-out recorded for ${from}`);
  }

  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'reviewrunner' }));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`ReviewRunner service running on port ${PORT}`));
