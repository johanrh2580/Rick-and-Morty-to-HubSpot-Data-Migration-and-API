// src/services/hubspotMigrationService.js
const hubspot = require('@hubspot/api-client');
const { isPrime } = require('../utils/math');
const { getCharacterById, getLocationByUrl, getCharactersInfo } = require('../clients/rickAndMortyClient');

/**
 * Maps properties from a Rick and Morty character object to HubSpot Contact properties.
 * @param {object} character - The Rick and Morty character object.
 * @returns {object} - An object formatted for HubSpot Contact creation/update.
 */
const characterToContactMapping = (character) => {
  const properties = {
    firstname: character.name,
    lastname: '', // Rick and Morty API does not provide a last name
    // Sanitize email: remove all non-alphanumeric characters from the name for a valid email format
    email: `${character.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@rickandmorty.com`,
    phone: '', // Not available in the API
    lifecyclestage: 'lead', // Default lifecycle stage
    // Custom properties for character-specific data in HubSpot
    character_id: character.id.toString(),
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
    // Custom properties for location-specific data in HubSpot
    location_id: location.id ? location.id.toString() : 'N/A', // Rick and Morty API provides location ID for primary locations
    location_type: location.type,
    location_dimension: location.dimension,
  };
  return { properties };
};

/**
 * Migrates Rick and Morty data to HubSpot.
 * This function orchestrates the fetching of characters, their associated locations,
 * and then creates or updates Contacts and Companies in HubSpot,
 * finally attempting to associate them.
 * @param {object} hubspotClient - The initialized HubSpot API client.
 */
async function migrateRickAndMortyToHubspot(hubspotClient) {
  console.log('INFO: Starting Rick and Morty to HubSpot migration process...');

  try {
    const allCharacters = [];
    let currentPage = 1;
    let totalPages = 1;

    // Get total pages to fetch all characters
    const info = await getCharactersInfo();
    totalPages = info.pages;
    console.log(`DEBUG: Total pages of characters: ${totalPages}`);


    const charactersToProcess = [];
    // Process characters with ID 1 and prime IDs up to 826
    for (let i = 1; i <= 826; i++) {
      if (i === 1 || isPrime(i)) {
        try {
          const character = await getCharacterById(i);
          charactersToProcess.push(character);
          console.log(`DEBUG: Collected character: ${character.name} (ID: ${character.id})`);
        } catch (error) {
          console.warn(`WARNING: Could not fetch character with ID ${i}: ${error.message}`);
        }
      }
    }
    console.log(`DEBUG: Fetched ${charactersToProcess.length} characters to process.`);


    const createdOrUpdatedContacts = [];
    const companyLocationMap = new Map(); // Map to store location URL -> HubSpot Company ID

    for (const character of charactersToProcess) {
      console.log(`INFO: Processing character: ${character.name} (ID: ${character.id})...`);

      // 1. Create or update Contact
      const contactProperties = characterToContactMapping(character);
      let contactId = null;
      try {
        const searchResponse = await hubspotClient.crm.contacts.searchApi.doSearch({
          query: character.id.toString(), // Search by character_id
          properties: ['character_id', 'email'],
        });

        if (searchResponse.results && searchResponse.results.length > 0) {
          // Contact found, attempt to update
          const existingContact = searchResponse.results[0];
          contactId = existingContact.id;
          console.log(`DEBUG: Contact '${character.name}' (character_id: ${character.id}) already exists in HubSpot with ID: ${contactId}. Attempting update...`);
          await hubspotClient.crm.contacts.basicApi.update(contactId, contactProperties);
          console.log(`SUCCESS: Contact '${character.name}' (ID: ${contactId}) updated successfully.`);
        } else {
          // Contact not found, create new
          const createResponse = await hubspotClient.crm.contacts.basicApi.create(contactProperties);
          contactId = createResponse.id;
          console.log(`SUCCESS: Contact '${character.name}' (ID: ${contactId}) created successfully.`);
        }
        createdOrUpdatedContacts.push({ characterId: character.id, contactId: contactId });
      } catch (error) {
        let errorMessage = `ERROR: Failed to find/create/update contact for '${character.name}' (character_id: ${character.id}).`;
        if (error.response && error.response.data) {
          errorMessage += ` Error details: HTTP-Code: ${error.response.status}\nMessage: ${error.response.data.message}\nBody: ${JSON.stringify(error.response.data)}\nHeaders: ${JSON.stringify(error.response.headers)}`;
        } else {
          errorMessage += ` Error details: ${error.message}`;
        }
        console.error(errorMessage);
        continue; // Skip to next character if contact creation/update failed
      }

      // 2. Create or update Company based on character's origin location
      const locationUrl = character.origin && character.origin.url;
      let companyId = null;

      if (locationUrl) {
        if (companyLocationMap.has(locationUrl)) {
          companyId = companyLocationMap.get(locationUrl);
          console.log(`DEBUG: Company for location '${character.origin.name}' (URL: ${locationUrl}) already processed with HubSpot ID: ${companyId}. Reusing ID.`);
        } else {
          try {
            const location = await getLocationByUrl(locationUrl);
            const companyProperties = locationToCompanyMapping(location);

            const searchCompanyResponse = await hubspotClient.crm.companies.searchApi.doSearch({
              query: location.name, // Search by company name
              properties: ['name', 'location_id'],
            });

            if (searchCompanyResponse.results && searchCompanyResponse.results.length > 0) {
              const existingCompany = searchCompanyResponse.results[0];
              companyId = existingCompany.id;
              console.log(`DEBUG: Company '${location.name}' already exists in HubSpot with ID: ${companyId}. Attempting update...`);
              await hubspotClient.crm.companies.basicApi.update(companyId, companyProperties);
              console.log(`SUCCESS: Company '${location.name}' (ID: ${companyId}) updated successfully.`);
            } else {
              const createCompanyResponse = await hubspotClient.crm.companies.basicApi.create(companyProperties);
              companyId = createCompanyResponse.id;
              console.log(`SUCCESS: Company '${location.name}' (ID: ${companyId}) created successfully.`);
            }
            companyLocationMap.set(locationUrl, companyId);
          } catch (error) {
            let errorMessage = `ERROR: Failed to find/create/update company for location '${character.origin.name}' (URL: ${locationUrl}).`;
            if (error.response && error.response.data) {
              errorMessage += ` Error details: HTTP-Code: ${error.response.status}\nMessage: ${error.response.data.message}\nBody: ${JSON.stringify(error.response.data)}\nHeaders: ${JSON.stringify(error.response.headers)}`;
            } else {
              errorMessage += ` Error details: ${error.message}`;
            }
            console.error(errorMessage);
            // Do not continue if company failed, as association will also fail
          }
        }
      } else {
        console.warn(`WARNING: Character '${character.name}' (ID: ${character.id}) has no valid origin URL to associate with a company.`);
      }

      // 3. Create Association between Contact and Company
      if (contactId && companyId) {
        try {
          // HubSpot's associations API typically requires 'associationCategory' and 'associationTypeId'.
          // For standard contact-to-company, these are usually 'HUBSPOT_DEFINED' and '279'.
          await hubspotClient.crm.associations.v4.basicApi.create(
            'contacts',
            contactId,
            'companies',
            companyId,
            [{
              associationCategory: 'HUBSPOT_DEFINED', // Standard HubSpot-defined association
              associationTypeId: 279, // Default association type for contact to company
            }]
          );
          console.log(`SUCCESS: Association created: Contact ${character.name} (ID: ${contactId}) <-> Company (ID: ${companyId})`);
        } catch (error) {
            let errorMessage = `ERROR: Failed to create association between contact ${contactId} and company ${companyId} for '${character.name}' (ID: ${character.id}).`;
            if (error.response && error.response.data) {
                errorMessage += ` Error details: HTTP-Code: ${error.response.status}\nMessage: ${error.response.data.message}\nBody: ${JSON.stringify(error.response.data, null, 2)}`;
            } else {
                errorMessage += ` Error: ${error.message}`;
            }
            console.error(errorMessage);
        }
      } else {
        console.warn(`WARNING: Could not associate character ${character.name} (ID: ${character.id}). Either contact not found, location URL missing, or company not created. Contact found: ${!!contactId}, Location URL provided: ${!!locationUrl}, Company mapped: ${companyLocationMap.has(locationUrl)}`);
      }
    }

    console.log('\nINFO: Rick and Morty to HubSpot migration process completed!');
    console.log(`SUMMARY: Total Contacts processed (created/updated): ${createdOrUpdatedContacts.length}`);
    console.log(`SUMMARY: Total Companies processed (created/updated): ${companyLocationMap.size}`); // Use map size for unique companies

  } catch (error) {
    console.error('CRITICAL ERROR: An unhandled error occurred during the migration process:', error.message);
    throw error;
  }
}

module.exports = {
  migrateRickAndMortyToHubspot,
};
