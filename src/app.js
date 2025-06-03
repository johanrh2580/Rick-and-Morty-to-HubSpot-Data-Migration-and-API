require('dotenv').config(); // Load environment variables at the very beginning
const express = require('express');
const hubspot = require('@hubspot/api-client');
const { migrateRickAndMortyToHubspot } = require('./services/hubspotMigrationService');
const webhookRoutes = require('./routes/webhookRoutes'); // ✅ NUEVA RUTA

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // Parse JSON bodies

// Rutas de Webhooks
app.use('/webhook', webhookRoutes); // --> /webhook/contacts y /webhook/companies

// RUTA DE SALUD
app.get('/', (req, res) => {
  res.status(200).send('Rick and Morty to HubSpot Migration API is running.');
});

// ENDPOINT DE MIGRACIÓN MANUAL
app.post('/migrate', async (req, res) => {
  console.log('INFO: API endpoint /migrate called. Initiating migration process...');
  const hubspotClient = new hubspot.Client({
    accessToken: process.env.HUBSPOT_SOURCE_TOKEN, // Token de la cuenta origen
  });

  try {
    await migrateRickAndMortyToHubspot(hubspotClient);
    res.status(200).json({ message: 'Migration process completed successfully.' });
    console.log('INFO: Migration process completed and success response sent.');
  } catch (error) {
    console.error('ERROR: Migration process failed:', error.message);
    res.status(500).json({ message: 'Migration process failed.', error: error.message });
  }
});

// INICIO DEL SERVIDOR
app.listen(PORT, () => {
  console.log(`INFO: Server is running on port ${PORT}`);
  console.log(`INFO: Use POST /migrate to trigger Rick & Morty migration`);
  console.log(`INFO: Webhook endpoints available at POST /webhook/contacts and /webhook/companies`);
});
