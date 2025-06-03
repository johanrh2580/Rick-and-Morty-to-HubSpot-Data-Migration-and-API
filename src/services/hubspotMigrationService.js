
/*
 * HubSpot CRM Integration Module
 * 
 * This module handles the migration of Rick and Morty character data to HubSpot CRM,
 * including character-to-contact and location-to-company mappings with associations.
 */

const hubspot = require('@hubspot/api-client');
const { isPrime } = require('../utils/math');
const { getCharacterById, getLocationByUrl, getCharactersInfo } = require('../clients/rickAndMortyClient');

/**
 * Validates email format according to standard patterns
 * @param {string} email - The email address to validate
 * @returns {boolean} True if valid email format, false otherwise
 */
function isValidEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

/**
 * Transforms Rick and Morty character data into HubSpot contact properties
 * @param {object} character - Character data from Rick and Morty API
 * @returns {object} Formatted properties object for HubSpot contact
 */
const characterToContactMapping = (character) => {
  // Normalize character name for email generation
  const cleanName = character.name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');  

  // Generate standardized email address
  let email = `${cleanName}${character.id}@rickandmorty.com`;
  
  // Fallback email generation if primary fails validation
  if (!isValidEmail(email)) {
    email = `character${character.id}@rickandmorty.com`;
  }

  // Construct HubSpot contact properties
  const properties = {
    firstname: character.name.split(' ')[0],
    lastname: character.name.split(' ').slice(1).join(' ') || '',
    email: email,
    phone: '',
    lifecyclestage: 'lead',
    character_id: character.id.toString(),
    character_status: character.status,
    character_species: character.species,
    character_gender: character.gender,
  };
  
  return { properties };
};

/**
 * Transforms Rick and Morty location data into HubSpot company properties
 * @param {object} location - Location data from Rick and Morty API
 * @returns {object} Formatted properties object for HubSpot company
 */
const locationToCompanyMapping = (location) => {
  const properties = {
    name: location.name,
  };
  return { properties };
};

/**
 * Handles contact upsert operations in HubSpot
 * @param {object} hubspotClient - Initialized HubSpot API client
 * @param {object} characterData - Rick and Morty character data
 * @returns {Promise<{id: string|null, created: boolean}>} Result object with contact ID and creation status
 */
async function findOrCreateContact(hubspotClient, characterData) {
    const characterId = characterData.id.toString();
    const contactProperties = characterToContactMapping(characterData).properties;

    try {
        // Search for existing contact by character_id
        const searchResponse = await hubspotClient.crm.contacts.searchApi.doSearch({
            filterGroups: [{
                filters: [{
                    propertyName: 'character_id',
                    operator: 'EQ',
                    value: characterId
                }]
            }],
            properties: ['character_id', 'email', 'firstname', 'lastname'],
            limit: 1
        });

        if (searchResponse.results && searchResponse.results.length > 0) {
            // Update existing contact
            const existingContact = searchResponse.results[0];
            console.log(`Contact '${characterData.name}' exists, updating ID: ${existingContact.id}`);
            const updateResponse = await hubspotClient.crm.contacts.basicApi.update(
                existingContact.id,
                { properties: contactProperties }
            );
            return { id: updateResponse.id, created: false };
        } else {
            // Create new contact
            console.log(`Creating new contact for '${characterData.name}'`);
            const createResponse = await hubspotClient.crm.contacts.basicApi.create(
                { properties: contactProperties }
            );
            return { id: createResponse.id, created: true };
        }
    } catch (error) {
        console.error(`Contact operation failed for '${characterData.name}'`, 
                      error.response ? error.response.body : error.message);
        return { id: null, created: false };
    }
}

/**
 * Handles company upsert operations in HubSpot
 * @param {object} hubspotClient - Initialized HubSpot API client
 * @param {object} locationData - Rick and Morty location data
 * @returns {Promise<string|null>} HubSpot company ID if successful, null otherwise
 */
async function findOrCreateCompany(hubspotClient, locationData) {
    const companyProperties = locationToCompanyMapping(locationData).properties;
    const companyName = locationData.name;

    try {
        // Search for existing company by name
        const searchResponse = await hubspotClient.crm.companies.searchApi.doSearch({
            filterGroups: [{
                filters: [{
                    propertyName: 'name',
                    operator: 'EQ',
                    value: companyName
                }]
            }],
            properties: ['name'],
            limit: 1
        });

        if (searchResponse.results && searchResponse.results.length > 0) {
            // Update existing company
            const existingCompany = searchResponse.results[0];
            console.log(`Company '${companyName}' exists, updating ID: ${existingCompany.id}`);
            const updateResponse = await hubspotClient.crm.companies.basicApi.update(
                existingCompany.id,
                { properties: companyProperties }
            );
            return updateResponse.id;
        } else {
            // Create new company
            console.log(`Creating new company '${companyName}'`);
            const createResponse = await hubspotClient.crm.companies.basicApi.create(
                { properties: companyProperties }
            );
            return createResponse.id;
        }
    } catch (error) {
        console.error(`Company operation failed for '${companyName}'`, 
                      error.response ? error.response.body : error.message);
        return null;
    }
}

/**
 * Creates contact-company associations in HubSpot
 * @param {object} hubspotClient - Initialized HubSpot API client
 * @param {string} contactHubspotId - HubSpot contact ID
 * @param {string} companyHubspotId - HubSpot company ID
 * @param {string} characterName - Character name for logging
 * @param {number} characterId - Character ID for logging
 */
async function createAssociation(hubspotClient, contactHubspotId, companyHubspotId, characterName, characterId) {
    if (!contactHubspotId || !companyHubspotId) {
        console.warn(`Skipping association for character '${characterName}' - missing IDs`);
        return;
    }

    try {
        await hubspotClient.crm.associations.v4.basicApi.create(
            'contact',
            contactHubspotId,
            'company',
            companyHubspotId,
            [{
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: 1
            }]
        );
        console.log(`Associated contact ${contactHubspotId} with company ${companyHubspotId}`);
    } catch (error) {
        console.error(`Association failed for character '${characterName}'`, 
                      error.response ? error.response.body : error.message);
    }
}

/**
 * Main migration function for Rick and Morty data to HubSpot
 * @param {object} hubspotClient - Initialized HubSpot API client
 */
async function migrateRickAndMortyToHubspot(hubspotClient) {
  console.log('Starting Rick and Morty data migration');

  const charactersToMigrate = [];
  const MAX_CHARACTER_ID = 826;

  console.log('Identifying characters (ID 1 and primes up to 826)...');

  try {
      // Fetch all characters with pagination
      const initialCharactersResponse = await getCharactersInfo();
      const totalPages = initialCharactersResponse.info.pages;
      let allCharacters = [];
      
      for (let i = 1; i <= totalPages; i++) {
          const pageResponse = await getCharactersInfo(i);
          if (pageResponse && pageResponse.results) {
              allCharacters = allCharacters.concat(pageResponse.results);
          }
      }

      // Identify prime IDs and ID 1
      const primeIds = new Set();
      for (let i = 2; i <= MAX_CHARACTER_ID; i++) {
          if (isPrime(i)) {
              primeIds.add(i);
          }
      }
      primeIds.add(1);

      // Filter characters for migration
      for (const character of allCharacters) {
          if (primeIds.has(character.id) && character.id <= MAX_CHARACTER_ID) {
              charactersToMigrate.push(character);
          }
      }
      console.log(`Found ${charactersToMigrate.length} characters to migrate`);

  } catch (error) {
      console.error('Failed to fetch characters:', error.message);
      throw error;
  }

  // Tracking variables
  const processedContactHubspotIds = new Set();
  const processedCompanyHubspotIds = new Set();
  const companyLocationMap = new Map();
  
  let contactsCreated = 0;
  let contactsUpdated = 0;
  let contactsFailed = 0;

  // Process each character
  for (const character of charactersToMigrate) {
    console.log(`Processing character: ${character.name}`);

    let contactHubspotId = null;
    let companyHubspotId = null;

    // Process contact
    const contactResult = await findOrCreateContact(hubspotClient, character);
    
    if (contactResult && contactResult.id) {
      processedContactHubspotIds.add(contactResult.id);
      if (contactResult.created) {
        contactsCreated++;
      } else {
        contactsUpdated++;
      }
      contactHubspotId = contactResult.id;
    } else {
      contactsFailed++;
    }

    // Process company if location exists
    const locationUrl = character.origin?.url;

    if (locationUrl) {
        if (companyLocationMap.has(locationUrl)) {
            companyHubspotId = companyLocationMap.get(locationUrl);
        } else {
            try {
                const locationData = await getLocationByUrl(locationUrl);
                if (locationData) {
                    companyHubspotId = await findOrCreateCompany(hubspotClient, locationData);
                    if (companyHubspotId) {
                        companyLocationMap.set(locationUrl, companyHubspotId);
                        processedCompanyHubspotIds.add(companyHubspotId);
                    }
                }
            } catch (error) {
                console.error(`Failed to process location: ${error.message}`);
            }
        }
    }

    // Create association
    await createAssociation(hubspotClient, contactHubspotId, companyHubspotId, character.name, character.id);
  }

  // Migration summary
  console.log('\nMigration completed');
  console.log(`Contacts processed: ${processedContactHubspotIds.size}`);
  console.log(`  - Created: ${contactsCreated}`);
  console.log(`  - Updated: ${contactsUpdated}`);
  console.log(`  - Failed: ${contactsFailed}`);
  console.log(`Companies processed: ${processedCompanyHubspotIds.size}`);
}

module.exports = {
  migrateRickAndMortyToHubspot,
};
*/
