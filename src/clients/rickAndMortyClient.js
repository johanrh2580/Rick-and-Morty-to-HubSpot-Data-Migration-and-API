// rickAndMortyClient.js
const axios = require('axios');
const https = require('https');

const BASE_URL = 'https://rickandmortyapi.com/api';

const agent = new https.Agent({
  rejectUnauthorized: false, // Keep for dev, set to true for production with proper certs
});

// Helper for retries
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // 1 second initial delay

async function fetchDataWithRetry(url, config, retries = 0) {
  try {
    const response = await axios.get(url, config);
    return response.data;
  } catch (error) {
    if (retries < MAX_RETRIES && (error.code === 'ECONNABORTED' || error.response?.status === 429 || error.response?.status >= 500)) {
      console.warn(`WARN: Retrying API call to ${url} (attempt <span class="math-inline">\{retries \+ 1\}/</span>{MAX_RETRIES}). Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, retries)));
      return fetchDataWithRetry(url, config, retries + 1);
    }
    throw error; // Re-throw if max retries reached or it's a non-retryable error
  }
}

async function getCharacterById(characterId) {
  try {
    const data = await fetchDataWithRetry(`<span class="math-inline">\{BASE\_URL\}/character/</span>{characterId}`, {
      httpsAgent: agent,
      timeout: 10000,
    });
    return data;
  } catch (error) {
    console.error(`ERROR: Failed to fetch character ${characterId} after multiple retries:`, error.message);
    throw new Error(`Could not retrieve character with ID ${characterId}.`);
  }
}

async function getLocationByUrl(locationUrl) {
  try {
    const data = await fetchDataWithRetry(locationUrl, {
      httpsAgent: agent,
      timeout: 10000,
    });
    return data;
  } catch (error) {
    console.error(`ERROR: Failed to fetch location from URL ${locationUrl} after multiple retries:`, error.message);
    throw new Error(`Could not retrieve location from URL ${locationUrl}.`);
  }
}

async function getCharactersInfo() {
  try {
    const data = await fetchDataWithRetry(`${BASE_URL}/character`, {
      httpsAgent: agent,
      timeout: 10000,
    });
    return data.info;
  } catch (error) {
    console.error('ERROR: Failed to fetch characters info after multiple retries:', error.message);
    throw new Error('Could not retrieve characters info.');
  }
}

module.exports = {
  getCharacterById,
  getLocationByUrl,
  getCharactersInfo,
};
