const axios = require('axios');
const https = require('https');

const BASE_URL = 'https://rickandmortyapi.com/api';

// Create an HTTPS agent for axios to handle SSL/TLS connections.
// rejectUnauthorized: false is used ONLY for debugging purposes in development environments.
// In a production environment, this should be true, or proper certificate handling should be implemented.
const agent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Fetches a character by their ID from the Rick and Morty API.
 * @param {number} characterId - The ID of the character to fetch.
 * @returns {Promise<object>} - A promise that resolves to the character data.
 * @throws {Error} - Throws an error if the API request fails.
 */
async function getCharacterById(characterId) {
  try {
    const response = await axios.get(`${BASE_URL}/character/${characterId}`, {
      httpsAgent: agent,
      timeout: 10000, // Add a 10-second timeout
    });
    return response.data;
  } catch (error) {
    console.error(`ERROR: Failed to fetch character ${characterId}:`, error.message);
    throw new Error(`Could not retrieve character with ID ${characterId}.`);
  }
}

/**
 * Fetches location data from a given URL.
 * @param {string} locationUrl - The URL of the location to fetch.
 * @returns {Promise<object>} - A promise that resolves to the location data.
 * @throws {Error} - Throws an error if the API request fails.
 */
async function getLocationByUrl(locationUrl) {
  try {
    const response = await axios.get(locationUrl, {
      httpsAgent: agent,
      timeout: 10000, // Add a 10-second timeout
    });
    return response.data;
  } catch (error) {
    console.error(`ERROR: Failed to fetch location from URL ${locationUrl}:`, error.message);
    throw new Error(`Could not retrieve location from URL ${locationUrl}.`);
  }
}

/**
 * Fetches characters information (including paginated results) from the Rick and Morty API.
 * This function can fetch a specific page or the initial info object.
 * @param {number} [page=null] - The page number to fetch. If null, fetches the first page to get metadata.
 * @returns {Promise<object>} - A promise that resolves to the response data (info and results).
 * @throws {Error} - Throws an error if the API request fails.
 */
async function getCharactersInfo(page = null) {
  let url = `${BASE_URL}/character`;
  if (page !== null) {
    url += `?page=${page}`;
  }

  try {
    const response = await axios.get(url, {
      httpsAgent: agent,
      timeout: 10000, // Add a 10-second timeout
    });
    return response.data; // Return the entire response data (includes info and results)
  } catch (error) {
    console.error(`ERROR: Failed to fetch characters info (page ${page !== null ? page : 'initial'}):`, error.message);
    throw new Error(`Could not retrieve characters info for page ${page !== null ? page : 'initial'}.`);
  }
}

module.exports = {
  getCharacterById,
  getLocationByUrl,
  getCharactersInfo,
};