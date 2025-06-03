const hubspot = require('@hubspot/api-client');
require('dotenv').config();
const axios = require('axios');

// Initialize HubSpot API clients for both Source and Mirror accounts
const hubspotClientSource = new hubspot.Client({ 
  accessToken: process.env.HUBSPOT_SOURCE_TOKEN 
});
const hubspotClientMirror = new hubspot.Client({ 
  accessToken: process.env.HUBSPOT_MIRROR_TOKEN 
});

// Maintains mapping between Source and Mirror company IDs
const companyIdMap = new Map();

/**
 * Synchronizes companies from Source to Mirror account
 * Performs upsert operations based on company name
 * @async
 */
async function syncCompanies() {
  console.log('Initiating company synchronization from Source to Mirror');
  let after = undefined;
  let allSourceCompanies = [];

  // Paginate through all companies in Source account
  do {
    const apiResponse = await hubspotClientSource.crm.companies.basicApi.getPage(100, after);
    allSourceCompanies = allSourceCompanies.concat(apiResponse.results);
    after = apiResponse.paging?.next?.after;
  } while (after);

  // Retrieve all companies from Mirror account for comparison
  let allMirrorCompanies = [];
  after = undefined;
  do {
    const apiResponse = await hubspotClientMirror.crm.companies.basicApi.getPage(100, after, ['name']);
    allMirrorCompanies = allMirrorCompanies.concat(apiResponse.results);
    after = apiResponse.paging?.next?.after;
  } while (after);

  // Process each company in Source account
  for (const company of allSourceCompanies) {
    const companyName = company.properties.name;
    const sourceCompanyId = company.id;

    if (!companyName) {
      console.warn(`Company ID ${sourceCompanyId} skipped - missing name property`);
      continue;
    }

    try {
      // Check for existing company in Mirror account
      const mirrorCompany = allMirrorCompanies.find(c => c.properties.name === companyName);

      const companyProperties = {
        name: companyName,
        phone: company.properties.phone || '',
        industry: company.properties.industry || ''
      };

      let upsertedCompany;
      if (mirrorCompany) {
        console.log(`Updating existing company: ${companyName}`);
        upsertedCompany = await hubspotClientMirror.crm.companies.basicApi.update(
          mirrorCompany.id, 
          { properties: companyProperties }
        );
      } else {
        console.log(`Creating new company: ${companyName}`);
        upsertedCompany = await hubspotClientMirror.crm.companies.basicApi.create({
          properties: companyProperties
        });
      }
      
      // Map Source company ID to Mirror company ID
      companyIdMap.set(sourceCompanyId, upsertedCompany.id);
      console.log(`Successfully synchronized company: ${companyName}`);

    } catch (error) {
      console.error(`Company synchronization failed: ${companyName}`, {
        error: error.message,
        details: error.response?.data
      });
    }
  }
  console.log('Company synchronization completed');
}

/**
 * Synchronizes contacts from Source to Mirror account
 * Uses character_id as primary key, falls back to email
 * @async
 */
async function syncContacts() {
  console.log('Initiating contact synchronization');
  let after = undefined;
  let allSourceContacts = [];

  // Paginate through all contacts in Source account
  do {
    const apiResponse = await hubspotClientSource.crm.contacts.basicApi.getPage(
      100,
      after,
      ['character_id', 'email', 'firstname', 'lastname', 
       'character_status', 'character_species', 
       'character_gender', 'associatedcompanyid']
    );
    allSourceContacts = allSourceContacts.concat(apiResponse.results);
    after = apiResponse.paging?.next?.after;
  } while (after);

  // Process each contact in Source account
  for (const contact of allSourceContacts) {
    const characterId = contact.properties.character_id;
    const email = contact.properties.email;

    if (!characterId) {
      console.warn(`Contact skipped - missing character_id:`, {
        contactId: contact.id,
        email: contact.properties.email
      });
      continue;
    }

    try {
      // Search for existing contact in Mirror account
      let mirrorContact = await findExistingContact(characterId, email);

      const contactProperties = {
        email: email,
        firstname: contact.properties.firstname,
        lastname: contact.properties.lastname || '',
        character_id: characterId,
        character_status: contact.properties.character_status,
        character_species: contact.properties.character_species,
        character_gender: contact.properties.character_gender
      };

      // Perform upsert operation
      const upsertedContact = await upsertContact(
        mirrorContact, 
        contactProperties, 
        characterId
      );

      // Handle company association if applicable
      await handleCompanyAssociation(
        upsertedContact.id, 
        contact.properties.associatedcompanyid
      );

    } catch (error) {
      console.error(`Contact synchronization failed:`, {
        characterId,
        error: error.message,
        stack: error.stack,
        apiError: error.response?.data
      });
    }
  }
  console.log('Contact synchronization completed');
}

/**
 * Finds existing contact in Mirror account
 * @param {string} characterId - Primary identifier
 * @param {string} email - Fallback identifier
 * @returns {Promise<Object|null>} Found contact or null
 */
async function findExistingContact(characterId, email) {
  // First try: Search by character_id
  if (characterId) {
    const searchResponse = await hubspotClientMirror.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: 'character_id',
          operator: 'EQ',
          value: characterId
        }]
      }],
      properties: ['email', 'firstname', 'lastname', 'character_id'],
      limit: 1
    });
    if (searchResponse.results.length > 0) {
      console.log(`Found existing contact by character_id: ${characterId}`);
      return searchResponse.results[0];
    }
  }

  // Fallback: Search by email
  if (email) {
    const searchResponse = await hubspotClientMirror.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email
        }]
      }],
      properties: ['email', 'firstname', 'lastname', 'character_id'],
      limit: 1
    });
    if (searchResponse.results.length > 0) {
      console.log(`Found existing contact by email: ${email}`);
      return searchResponse.results[0];
    }
  }

  return null;
}

/**
 * Performs contact upsert operation
 * @param {Object|null} existingContact - Existing contact or null
 * @param {Object} properties - Contact properties
 * @param {string} characterId - For logging
 * @returns {Promise<Object>} Upserted contact
 */
async function upsertContact(existingContact, properties, characterId) {
  if (existingContact) {
    console.log(`Updating contact ${existingContact.id}`);
    return await hubspotClientMirror.crm.contacts.basicApi.update(
      existingContact.id, 
      { properties }
    );
  } else {
    console.log(`Creating new contact with character_id: ${characterId}`);
    return await hubspotClientMirror.crm.contacts.basicApi.create({
      properties
    });
  }
}

/**
 * Handles company association for a contact
 * @param {string} contactId - Mirror contact ID
 * @param {string} sourceCompanyId - Source company ID
 * @returns {Promise<void>}
 */
async function handleCompanyAssociation(contactId, sourceCompanyId) {
  if (!sourceCompanyId) return;

  const mirrorCompanyId = companyIdMap.get(sourceCompanyId);
  if (!mirrorCompanyId) {
    console.warn(`No Mirror company found for Source ID: ${sourceCompanyId}`);
    return;
  }

  try {
    await hubspotClientMirror.crm.associations.v4.batchApi.create(
      'contact', 
      'company', 
      [{
        from: { id: contactId },
        to: { id: mirrorCompanyId },
        types: [{ 
          associationCategory: 'HUBSPOT_DEFINED', 
          associationTypeId: 1 
        }]
      }]
    );
    console.log(`Associated contact ${contactId} with company ${mirrorCompanyId}`);
  } catch (error) {
    console.error(`Association failed:`, {
      contactId,
      mirrorCompanyId,
      error: error.message
    });
  }
}

/**
 * Executes full synchronization pipeline
 * @async
 */
async function fullSync() {
  try {
    await syncCompanies();
    await syncContacts();
  } catch (error) {
    console.error('Full synchronization failed:', {
      error: error.message,
      details: error.response?.data
    });
  }
}

// Express server configuration
const express = require('express');
const app = express();
app.use(express.json());

// Start server and initiate synchronization
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server operational on port ${process.env.PORT || 3000}`);
  fullSync();
});

// Webhook endpoint for future incremental updates
app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  res.status(200).send('Webhook acknowledged');
});
