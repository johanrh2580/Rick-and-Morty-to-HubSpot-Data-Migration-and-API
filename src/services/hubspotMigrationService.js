const hubspot = require('@hubspot/api-client');
const { isPrime } = require('../utils/math');
const { getCharacterById, getLocationByUrl, getCharactersInfo } = require('../clients/rickAndMortyClient');

/**
 * Validates if an email address has a valid format.
 * @param {string} email - The email address to validate.
 * @returns {boolean} - True if the email is valid, false otherwise.
 */
function isValidEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}


/**
 * Maps properties from a Rick and Morty character object to HubSpot Contact properties.
 * @param {object} character - The Rick and Morty character object.
 * @returns {object} - An object formatted for HubSpot Contact creation/update.
 */
const characterToContactMapping = (character) => {
  // Generate a valid email format
  const cleanName = character.name
  .toLowerCase()
  .replace(/[^a-z0-9]/g, ''); 

const email = ${cleanName}${character.id}@rickandmorty.com;

  
  const properties = {
    firstname: character.name.split(' ')[0], // Extract first name
    lastname: character.name.split(' ').slice(1).join(' ') || '', // Extract rest as last name
    // Generate unique valid email
    email: ${cleanName}${character.id}@rickandmorty.com,
    phone: '', // Phone number not available in the API
    lifecyclestage: 'lead', // Default lifecycle stage for new contacts
    character_id: character.id.toString(), // Ensure character_id is a string as per HubSpot property type
    character_status: character.status,
    character_species: character.species,
    character_gender: character.gender,
  };
  
  // Fallback email if generated is invalid
  if (!isValidEmail(email)) {
    email = character${character.id}@rickandmorty.com;
  }

  
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
    // Additional company properties can be added here if available from the Rick and Morty API
    // e.g., 'city': location.dimension, 'state': location.type,
  };
  return { properties };
};

/**
 * Finds an existing HubSpot Contact by 'character_id' or creates a new one.
 * @param {object} hubspotClient - The HubSpot API client instance.
 * @param {object} characterData - The Rick and Morty character data.
 * @returns {Promise<string|null>} The HubSpot contact ID if successful, null otherwise.
 */
async function findOrCreateContact(hubspotClient, characterData) {
    const characterId = characterData.id.toString();
    const contactProperties = characterToContactMapping(characterData).properties;

    try {
        // Attempt to search for an existing contact using the custom 'character_id' property.
        const searchResponse = await hubspotClient.crm.contacts.searchApi.doSearch({
            filterGroups: [{
                filters: [{
                    propertyName: 'character_id',
                    operator: 'EQ',
                    value: characterId
                }]
            }],
            properties: ['character_id', 'email', 'firstname', 'lastname'],
            limit: 1 // We only need to find one if it exists
        });

        if (searchResponse.results && searchResponse.results.length > 0) {
            const existingContact = searchResponse.results[0];
            console.log(DEBUG: Contact '${characterData.name}' (character_id: ${characterId}) already exists in HubSpot with ID: ${existingContact.id}. Attempting update...);
            // Update the existing contact's properties
            const updateResponse = await hubspotClient.crm.contacts.basicApi.update(
                existingContact.id,
                { properties: contactProperties }
            );
            return updateResponse.id; // Return the HubSpot Contact ID
        } else {
            // Contact does not exist, proceed with creation.
            console.log(DEBUG: Creating new contact for '${characterData.name}' (character_id: ${characterId})...);
            const createResponse = await hubspotClient.crm.contacts.basicApi.create(
                { properties: contactProperties }
            );
            return createResponse.id; // Return the new HubSpot Contact ID
        }
    } catch (error) {
        console.error(ERROR: Failed to find/create/update contact for '${characterData.name}' (character_id: ${characterId}). Error details:, error.response ? JSON.stringify(error.response.body, null, 2) : error.message);
        return null; // Return null on error
    }
}

/**
 * Finds an existing HubSpot Company by name or creates a new one.
 * @param {object} hubspotClient - The HubSpot API client instance.
 * @param {object} locationData - The Rick and Morty location data.
 * @returns {Promise<string|null>} The HubSpot company ID if successful, null otherwise.
 */
async function findOrCreateCompany(hubspotClient, locationData) {
    const companyProperties = locationToCompanyMapping(locationData).properties;
    const companyName = locationData.name;

    try {
        // Attempt to search for an existing company by its name.
        const searchResponse = await hubspotClient.crm.companies.searchApi.doSearch({
            filterGroups: [{
                filters: [{
                    propertyName: 'name',
                    operator: 'EQ',
                    value: companyName
                }]
            }],
            properties: ['name'],
            limit: 1 // We only need to find one if it exists
        });

        if (searchResponse.results && searchResponse.results.length > 0) {
            const existingCompany = searchResponse.results[0];
            console.log(DEBUG: Company '${companyName}' already exists in HubSpot with ID: ${existingCompany.id}. Attempting update...);
            // Update the existing company's properties
            const updateResponse = await hubspotClient.crm.companies.basicApi.update(
                existingCompany.id,
                { properties: companyProperties }
            );
            return updateResponse.id; // Return the HubSpot Company ID
        } else {
            // Company does not exist, proceed with creation.
            console.log(DEBUG: Creating new company for '${companyName}'...);
            const createResponse = await hubspotClient.crm.companies.basicApi.create(
                { properties: companyProperties }
            );
            return createResponse.id; // Return the new HubSpot Company ID
        }
    } catch (error) {
        console.error(ERROR: Failed to find/create/update company for '${companyName}'. Error details:, error.response ? JSON.stringify(error.response.body, null, 2) : error.message);
        return null; // Return null on error
    }
}

/**
 * Creates an association between a HubSpot Contact and a HubSpot Company.
 * This function only proceeds if both HubSpot IDs are valid.
 * @param {object} hubspotClient - The HubSpot API client instance.
 * @param {string} contactHubspotId - The HubSpot ID of the contact.
 * @param {string} companyHubspotId - The HubSpot ID of the company.
 * @param {string} characterName - The name of the Rick and Morty character (for logging).
 * @param {number} characterId - The ID of the Rick and Morty character (for logging).
 */
async function createAssociation(hubspotClient, contactHubspotId, companyHubspotId, characterName, characterId) {
    // Log a warning and skip association if either ID is missing.
    if (!contactHubspotId || !companyHubspotId) {
        console.warn(WARNING: Could not associate character '${characterName}' (ID: ${characterId}). Missing HubSpot Contact ID (${contactHubspotId}) or HubSpot Company ID (${companyHubspotId}).);
        return;
    }

    try {
        // Define the association types and objects for API v4
       await hubspotClient.crm.associations.v4.basicApi.create(
          'contact',
          contactHubspotId,
          'company',
          companyHubspotId,
          [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 1 // tipo contacto ↔ empresa estándar
            }
          ]
        );

        console.log(INFO: Association created: Contact '${characterName}' (HubSpot ID: ${contactHubspotId}) associated with Company (HubSpot ID: ${companyHubspotId}).);
    } catch (error) {
        console.error(ERROR: Failed to create association between contact ${contactHubspotId} and company ${companyHubspotId} for '${characterName}' (ID: ${characterId}). Error details:, error.response ? JSON.stringify(error.response.body, null, 2) : error.message);
    }
}

/**
 * Main function to orchestrate the migration of Rick and Morty character data to HubSpot.
 * This includes fetching characters, creating/updating contacts and companies, and establishing associations.
 * @param {object} hubspotClient - The initialized HubSpot API client.
 */
async function migrateRickAndMortyToHubspot(hubspotClient) {
  console.log('INFO: Starting Rick and Morty to HubSpot migration process...');

  const charactersToMigrate = [];
  const MAX_CHARACTER_ID = 826; // Maximum character ID to consider for migration

  console.log('INFO: Identifying characters (ID 1 and prime IDs up to 826)...');

  // Fetch all characters to filter by ID and collect all pages
  try {
      // Fetch initial info to get total number of pages
      const initialCharactersResponse = await getCharactersInfo(); // Call without page to get metadata
      const totalPages = initialCharactersResponse.info.pages;
      console.log(DEBUG: Total pages of characters: ${totalPages});

      // Collect all characters from all available pages
      let allCharacters = [];
      for (let i = 1; i <= totalPages; i++) {
          const pageResponse = await getCharactersInfo(i); // Fetch each page
          if (pageResponse && pageResponse.results) {
              allCharacters = allCharacters.concat(pageResponse.results);
          }
      }
      console.log(DEBUG: Fetched ${allCharacters.length} characters in total from all pages.);

      // Filter characters based on prime IDs and ID 1 (Rick Sanchez)
      const primeIds = new Set();
      for (let i = 2; i <= MAX_CHARACTER_ID; i++) {
          if (isPrime(i)) {
              primeIds.add(i);
          }
      }
      primeIds.add(1); // Add Rick Sanchez (ID: 1) as per requirements

      for (const character of allCharacters) {
          if (primeIds.has(character.id) && character.id <= MAX_CHARACTER_ID) {
              charactersToMigrate.push(character);
              console.log(DEBUG: Collected character: ${character.name} (ID: ${character.id}));
          }
      }
      console.log(INFO: ${charactersToMigrate.length} characters identified for migration.);

  } catch (error) {
      console.error('CRITICAL ERROR: Failed to fetch characters from Rick and Morty API during identification:', error.message);
      throw new Error('Failed to retrieve characters for migration.');
  }

  // Use Maps to store HubSpot IDs and track unique processed entities
  const processedContactHubspotIds = new Set();
  const processedCompanyHubspotIds = new Set();
  const companyLocationMap = new Map(); // Maps Rick and Morty location URL to HubSpot Company ID

  for (const character of charactersToMigrate) {
    console.log(\nINFO: Processing character: ${character.name} (ID: ${character.id})...);

    let contactHubspotId = null;
    let companyHubspotId = null;

    // 1. Create or Update Contact in HubSpot
    contactHubspotId = await findOrCreateContact(hubspotClient, character);
    if (contactHubspotId) {
        processedContactHubspotIds.add(contactHubspotId);
    }

    // 2. Create or Update Company in HubSpot (if location data is available)
    const locationUrl = character.origin?.url; // Use optional chaining for safety

    if (locationUrl) {
        // Check if the company for this location URL has already been processed
        if (companyLocationMap.has(locationUrl)) {
            companyHubspotId = companyLocationMap.get(locationUrl);
            console.log(DEBUG: Company for location '${character.origin.name}' (URL: ${locationUrl}) already processed with HubSpot ID: ${companyHubspotId}. Reusing ID.);
        } else {
            try {
                const locationData = await getLocationByUrl(locationUrl);
                if (locationData) {
                    companyHubspotId = await findOrCreateCompany(hubspotClient, locationData);
                    if (companyHubspotId) {
                        companyLocationMap.set(locationUrl, companyHubspotId); // Store the HubSpot ID for reuse
                        processedCompanyHubspotIds.add(companyHubspotId);
                    }
                }
            } catch (error) {
                console.error(ERROR: Failed to fetch or create company for location '${character.origin.name}' (URL: ${locationUrl}). Details:, error.message);
            }
        }
    } else {
        console.warn(WARNING: Character '${character.name}' (ID: ${character.id}) has no valid origin URL to associate with a company.);
    }

    // 3. Create Association (ONLY if both HubSpot IDs are valid)
    await createAssociation(hubspotClient, contactHubspotId, companyHubspotId, character.name, character.id);
  }

  console.log('\nINFO: Rick and Morty to HubSpot migration process completed!');
  console.log(SUMMARY: Total Contacts processed (created/updated): ${processedContactHubspotIds.size});
  console.log(SUMMARY: Total Unique Companies processed (created/updated): ${processedCompanyHubspotIds.size});
}

module.exports = {
  migrateRickAndMortyToHubspot,
};
