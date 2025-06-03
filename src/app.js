
require('dotenv').config(); // Load environment variables at the very beginning
const express = require('express'); // Import the express library
const hubspot = require('@hubspot/api-client');
const { migrateRickAndMortyToHubspot } = require('./services/hubspotMigrationService');

const app = express();
// The port for the server to listen on. Use process.env.PORT for deployment environments,
// or a default (e.g., 3000) for local development.
const PORT = process.env.PORT || 3000; 

// Initialize the HubSpot client using the access token from environment variables.
// This client instance will be passed to the migration service.
const hubspotClient = new hubspot.Client({
  accessToken: process.env.HUBSPOT_SOURCE_TOKEN,
});

// Middleware to parse JSON bodies in requests.
app.use(express.json());

// Define a simple health check endpoint.
app.get('/', (req, res) => {
  res.status(200).send('Rick and Morty to HubSpot Migration API is running.');
});

/**
 * API Endpoint to trigger the Rick and Morty to HubSpot data migration.
 * This endpoint will be called by external services (e.g., HubSpot workflows).
 * It runs the migration process and sends a response indicating success or failure.
 */
app.post('/migrate', async (req, res) => {
  console.log('INFO: API endpoint /migrate called. Initiating migration process...');
  try {
    // Execute the migration logic.
    await migrateRickAndMortyToHubspot(hubspotClient);
    // Send a success response back to the caller.
    res.status(200).json({ message: 'Migration process completed successfully.' });
    console.log('INFO: Migration process completed and success response sent.');
  } catch (error) {
    // Log the error and send an error response back to the caller.
    console.error('ERROR: Migration process failed:', error.message);
    res.status(500).json({ message: 'Migration process failed.', error: error.message });
  }
});

// Start the Express server, listening on the specified port.
app.listen(PORT, () => {
  console.log(`INFO: Server is running on port ${PORT}`);
  console.log('INFO: Access /migrate endpoint (POST request) to trigger the migration.');
});