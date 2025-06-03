// src/services/hubspotMigrationService.js
const hubspot = require('@hubspot/api-client');
const { isPrime } = require('../utils/math');
const { getCharacterById, getLocationByUrl, getCharactersInfo } = require('../clients/rickAndMortyClient');

const MAX_HUBSPOT_RETRIES = 3;
const HUBSPOT_INITIAL_RETRY_DELAY_MS = 2000; // 2 seconds initial delay

/**
 * Helper function to make HubSpot API calls with retry logic and rate limit handling.
 * @param {Function} apiCall - The HubSpot API function to call (e.g., hubspotClient.crm.contacts.basicApi.create).
 * @param {Array} args - Arguments to pass to the API function.
 * @returns {Promise<object>} - The result of the API call.
 * @throws {Error} - Throws an error if the API call fails after all retries.
 */
async function makeHubspotApiCallWithRetry(apiCall, ...args) {
  for (let i = 0; i < MAX_HUBSPOT_RETRIES; i++) {
    try {
      return await apiCall(...args);
    } catch (error) {
      if (error.response?.status === 429) {
        // HubSpot rate limit hit
        const retryAfter = parseInt(error.response.headers['retry-after'], 10) * 1000 || HUBSPOT_INITIAL_RETRY_DELAY_MS * Math.pow(2, i);
        console.warn(`WARN: HubSpot rate limit hit. Retrying after ${retryAfter / 1000} seconds (attempt ${i + 1}/${MAX_HUBSPOT_RETRIES}). Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
      } else if (error.response?.status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        // Server error or network error
        const delay = HUBSPOT_INITIAL_RETRY_DELAY_MS * Math.pow(2, i);
        console.warn(`WARN: HubSpot API error (status ${error.response?.status || 'network error'}). Retrying after ${delay / 1000} seconds (attempt ${i + 1}/${MAX_HUBSPOT_RETRIES}). Error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Non-retryable error (e.g., 400 Bad Request, 404 Not Found, 409 Conflict)
        console.error(`ERROR: Non-retryable HubSpot API error: ${error.message}. Status: ${error.response?.status}`);
        if (error.response && error.response.data) {
          console.error('HubSpot API Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
      }
    }
  }
  const finalError = new Error(`Failed HubSpot API call after ${MAX_HUBSPOT_RETRIES} attempts.`);
  finalError.originalError = args[0]; // Attach the original arguments or context if possible
  throw finalError;
}

/**
 * Maps properties from a Rick and Morty character object to HubSpot Contact properties.
 * @param {object} character - The Rick and Morty character object.
 * @returns {object} - An object formatted for HubSpot Contact creation/update.
 */
const characterToContactMapping = (character) => {
  const properties = {
    firstname: character.name,
    lastname: '', // Rick and Morty API does not provide a last name
    // Generate a unique email using character ID to avoid collisions in HubSpot for characters with same name
    email: `${character.name.toLowerCase().replace(/\s/g, '')}_${character.id}@rickandmorty.com`,
    phone: '', // Not available in the API
    lifecyclestage: 'lead', // Default lifecycle stage
    // Custom properties for character-specific data in HubSpot
    character_id: character.id.toString(), // Ensure this is a string if it's a text field in HubSpot
    character_status: character.status,
    character_species: character.species,
    character_gender: character.gender,
  };
  return { properties };
};

/**
 * Maps properties from a Rick and Morty location object to HubSpot Company properties.
 * @param {object} location - The Rick and Morty location object.
 * @returns {object} - An object formatted for HubSpot Company creation/update.
 */
const locationToCompanyMapping = (location) => {
  const properties = {
    name: location.name,
    // Use the location type if available, otherwise default
    industry: location.type || 'Fictional Location',
    // Custom property for location ID/URL
    location_url: location.url, // Store the Rick and Morty location URL
    location_dimension: location.dimension,
  };
  return { properties };
};

/**
 * Migrates Rick and Morty character data to HubSpot Contacts and Companies.
 * Associates Contacts with Companies based on character origin.
 * @param {object} hubspotClient - Initialized HubSpot API client.
 */
async function migrateRickAndMortyToHubspot(hubspotClient) {
  console.log('INFO: Starting Rick and Morty to HubSpot migration process...');
  try {
    const charactersToMigrate = [];
    console.log('INFO: Identifying characters (ID 1 and prime IDs up to 826)...');

    // Fetch total character info to determine the loop limit
    const info = await getCharactersInfo();
    const totalCharacters = info.count;
    console.log(`DEBUG: Total characters available in Rick and Morty API: ${totalCharacters}`);

    // Collect characters with ID 1 and prime IDs
    for (let i = 1; i <= Math.min(826, totalCharacters); i++) { // Cap at 826 as per requirement
      if (i === 1 || isPrime(i)) {
        try {
          const character = await getCharacterById(i);
          charactersToMigrate.push(character);
          console.log(`DEBUG: Collected character: ${character.name} (ID: ${character.id})`);
        } catch (error) {
          console.error(`ERROR: Skipping character ID ${i} due to fetch error:`, error.message);
          // Continue to next character even if one fails
        }
      }
    }

    console.log(`DEBUG: Fetched ${charactersToMigrate.length} characters for migration.`);

    const createdOrUpdatedContacts = []; // To store successfully created/updated HubSpot contacts (with HubSpot IDs)
    const companyLocationMap = new Map(); // Maps Rick and Morty location URL to HubSpot Company ID

    console.log('\nINFO: --- Phase 1: Migrating Companies ---');
    // Phase 1: Create/update all unique companies first
    const uniqueLocationUrls = [...new Set(charactersToMigrate.map(c => c.origin?.url).filter(Boolean))];

    for (const locationUrl of uniqueLocationUrls) {
      if (!locationUrl) continue; // Should not happen with filter(Boolean) but as a safeguard

      try {
        const locationDetails = await getLocationByUrl(locationUrl);
        const companyObj = locationToCompanyMapping(locationDetails);

        let companyRecord;
        // Attempt to find existing company by name or location_url (custom property)
        // Adjust search based on your HubSpot company deduplication strategy
        try {
          const searchResponse = await makeHubspotApiCallWithRetry(
            hubspotClient.crm.companies.searchApi.doSearch,
            {
              query: companyObj.properties.name,
              properties: ['name', 'location_url'], // Properties to retrieve for deduplication
              limit: 1,
              filterGroups: [
                {
                  filters: [
                    { propertyName: 'name', operator: 'EQ', value: companyObj.properties.name }
                  ]
                }
              ]
            }
          );

          if (searchResponse.results.length > 0) {
            companyRecord = searchResponse.results[0];
            console.log(`INFO: Found existing company for "${companyObj.properties.name}" (ID: ${companyRecord.id}). Attempting to update.`);
            // Update existing company
            companyRecord = await makeHubspotApiCallWithRetry(
              hubspotClient.crm.companies.basicApi.update,
              companyRecord.id,
              companyObj // Use the new properties for update
            );
            console.log(`SUCCESS: Company updated: "${companyObj.properties.name}" (ID: ${companyRecord.id})`);
          } else {
            // No existing company found, create a new one
            companyRecord = await makeHubspotApiCallWithRetry(
              hubspotClient.crm.companies.basicApi.create,
              companyObj
            );
            console.log(`SUCCESS: Company created: "${companyObj.properties.name}" (ID: ${companyRecord.id})`);
          }
        } catch (searchError) {
          // If search fails for any reason, proceed to create
          console.warn(`WARN: Company search failed for "${companyObj.properties.name}". Attempting to create new. Error: ${searchError.message}`);
          companyRecord = await makeHubspotApiCallWithRetry(
            hubspotClient.crm.companies.basicApi.create,
            companyObj
          );
          console.log(`SUCCESS: Company created (after search error): "${companyObj.properties.name}" (ID: ${companyRecord.id})`);
        }

        companyLocationMap.set(locationUrl, companyRecord.id);

      } catch (error) {
        console.error(`ERROR: Failed to create/update company for location URL ${locationUrl}:`, error.message);
        // Do not add to map if creation failed. This will result in no association later for contacts from this location.
      }
    }

    console.log('\nINFO: --- Phase 2: Migrating Contacts ---');
    // Phase 2: Create/update all contacts
    for (const character of charactersToMigrate) {
      try {
        const contactObj = characterToContactMapping(character);
        let hubspotContact;

        // Try to find an existing contact by email before creating
        try {
          // Assuming 'email' is the primary unique identifier for contacts in HubSpot
          const existingContacts = await makeHubspotApiCallWithRetry(
            hubspotClient.crm.contacts.searchApi.doSearch,
            {
              query: contactObj.properties.email,
              properties: ['email', 'firstname', 'lastname', 'character_id'],
              limit: 1,
              filterGroups: [
                {
                  filters: [
                    { propertyName: 'email', operator: 'EQ', value: contactObj.properties.email }
                  ]
                }
              ]
            }
          );

          if (existingContacts.results.length > 0) {
            hubspotContact = existingContacts.results[0];
            console.log(`INFO: Found existing contact for ${character.name} (ID: ${character.id}, HubSpot ID: ${hubspotContact.id}). Updating.`);
            // Update the existing contact
            hubspotContact = await makeHubspotApiCallWithRetry(
              hubspotClient.crm.contacts.basicApi.update,
              hubspotContact.id,
              contactObj
            );
          } else {
            // No existing contact, create a new one
            hubspotContact = await makeHubspotApiCallWithRetry(
              hubspotClient.crm.contacts.basicApi.create,
              contactObj
            );
            console.log(`SUCCESS: Contact created for ${character.name} (ID: ${character.id}, HubSpot ID: ${hubspotContact.id}).`);
          }
        } catch (searchError) {
          // If search fails, assume it's a non-existent contact and try to create
          console.warn(`WARN: Contact search failed for ${character.name}. Attempting to create new. Error: ${searchError.message}`);
          hubspotContact = await makeHubspotApiCallWithRetry(
            hubspotClient.crm.contacts.basicApi.create,
            contactObj
          );
          console.log(`SUCCESS: Contact created (after search error) for ${character.name} (ID: ${character.id}, HubSpot ID: ${hubspotContact.id}).`);
        }

        createdOrUpdatedContacts.push(hubspotContact);

      } catch (error) {
        console.error(`ERROR: Failed to create/update contact for character ${character.name} (ID: ${character.id}):`, error.message);
        if (error.response && error.response.data) {
          console.error('HubSpot API Response Data:', JSON.stringify(error.response.data, null, 2));
        }
        // This contact will not be in createdOrUpdatedContacts, so no association will be attempted for it.
      }
    }

    console.log('\nINFO: --- Phase 3: Creating Associations ---');
    // Phase 3: Create associations between contacts and companies
    for (const contact of createdOrUpdatedContacts) {
      // Find the original Rick and Morty character data for this HubSpot contact
      // We assume `character_id` custom property stores the original Rick and Morty ID
      const character = charactersToMigrate.find(c => c.id.toString() === contact.properties.character_id);

      if (!character) {
        console.warn(`WARNING: Could not find original Rick and Morty character data for HubSpot contact ${contact.properties.firstname} (HubSpot ID: ${contact.id}). Skipping association.`);
        continue;
      }

      const locationUrl = character.origin?.url; // Use optional chaining for safer access
      const companyId = locationUrl ? companyLocationMap.get(locationUrl) : null;

      if (contact && contact.id && companyId) {
        try {
          await makeHubspotApiCallWithRetry(
            hubspotClient.crm.associations.v4.basicApi.create,
            'contact',
            'company',
            {
              from: { id: contact.id },
              to: { id: companyId },
              type: 'contact_to_company', // Standard association type
            }
          );
          console.log(`SUCCESS: Association created: Contact "${contact.properties.firstname}" (HubSpot ID: ${contact.id}) <-> Company (HubSpot ID: ${companyId})`);
        } catch (error) {
          let errorMessage = `ERROR: Failed to create association between contact "${contact.properties.firstname}" (HubSpot ID: ${contact.id}) and company (HubSpot ID: ${companyId}).`;
          if (error.response && error.response.data) {
            errorMessage += ` HubSpot API Error: ${JSON.stringify(error.response.data, null, 2)}`;
          } else {
            errorMessage += ` Error: ${error.message}`;
          }
          console.error(errorMessage);
        }
      } else {
        let reasons = [];
        if (!contact || !contact.id) reasons.push('HubSpot Contact not found or missing ID');
        if (!locationUrl) reasons.push('Rick and Morty Location URL missing');
        if (locationUrl && !companyId) reasons.push('HubSpot Company not created or mapped for this location');

        console.warn(`WARNING: Could not associate character "${character.name}" (ID: ${character.id}). Reason(s): ${reasons.join(', ')}.`);
      }
    }

    console.log('\nINFO: Rick and Morty to HubSpot migration process completed!');
    console.log(`SUMMARY: Total Contacts processed (created/updated): ${createdOrUpdatedContacts.length}`);
    console.log(`SUMMARY: Total Companies processed (created/updated): ${companyLocationMap.size}`); // Use map size for unique companies

  } catch (error) {
    console.error('CRITICAL ERROR: An unhandled error occurred during the migration process:', error.message);
    if (error.originalError) {
      console.error('Original Error Context:', error.originalError);
    }
    throw error;
  }
}

module.exports = {
  migrateRickAndMortyToHubspot,
  characterToContactMapping,
  locationToCompanyMapping,
};
