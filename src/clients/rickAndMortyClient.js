const axios = require('axios');
const https = require('https');

// Base API endpoint for Rick and Morty API
const BASE_URL = 'https://rickandmortyapi.com/api';

/**
 * HTTPS agent configuration for axios requests
 * Note: Disabling certificate validation (rejectUnauthorized: false) 
 * should only be used in development environments.
 * Production environments should implement proper certificate validation.
 */
const agent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Retrieves character data by ID from Rick and Morty API
 * @param {number} characterId - Unique identifier for the character
 * @returns {Promise<Object>} Character data object
 * @throws Will throw error if request fails or times out
 */
async function getCharacterById(characterId) {
  try {
    const response = await axios.get(`${BASE_URL}/character/${characterId}`, {
      httpsAgent: agent,
      timeout: 10000 // 10 second timeout
    });
    return response.data;
  } catch (error) {
    console.error(`Character fetch failed for ID ${characterId}:`, {
      error: error.message,
      status: error.response?.status
    });
    throw new Error(`API request failed for character ${characterId}`);
  }
}

/**
 * Fetches location data from specified URL
 * @param {string} locationUrl - Complete API endpoint for location
 * @returns {Promise<Object>} Location data object
 * @throws Will throw error if request fails or times out
 */
async function getLocationByUrl(locationUrl) {
  try {
    const response = await axios.get(locationUrl, {
      httpsAgent: agent,
      timeout: 10000 // 10 second timeout
    });
    return response.data;
  } catch (error) {
    console.error(`Location fetch failed for URL ${locationUrl}:`, {
      error: error.message,
      status: error.response?.status
    });
    throw new Error(`API request failed for location ${locationUrl}`);
  }
}

/**
 * Retrieves paginated character data from Rick and Morty API
 * @param {number|null} [page=null] - Specific page number or null for initial data
 * @returns {Promise<Object>} Object containing character data and pagination info
 * @throws Will throw error if request fails or times out
 */
async function getCharactersInfo(page = null) {
  const endpoint = page ? `${BASE_URL}/character?page=${page}` : `${BASE_URL}/character`;
  
  try {
    const response = await axios.get(endpoint, {
      httpsAgent: agent,
      timeout: 10000 // 10 second timeout
    });
    return response.data;
  } catch (error) {
    console.error(`Character list fetch failed for page ${page || 'initial'}:`, {
      error: error.message,
      status: error.response?.status
    });
    throw new Error(`API request failed for characters page ${page || 'initial'}`);
  }
}

module.exports = {
  getCharacterById,
  getLocationByUrl,
  getCharactersInfo
};
